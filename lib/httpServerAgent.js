/*
 * @copyright Copyright (c) Sematext Group, Inc. - All Rights Reserved
 *
 * @licence SPM for NodeJS is free-to-use, proprietary software.
 * THIS IS PROPRIETARY SOURCE CODE OF Sematext Group, Inc. (Sematext)
 * This source code may not be copied, reverse engineered, or altered for any purpose.
 * This source code is to be used exclusively by users and customers of Sematext.
 * Please see the full license (found in LICENSE in this distribution) for details on its license and the licenses of its dependencies.
 */

'use strict'

/**
 * HttpServerAgent - wraping createServer to add instrumentation
 *
 */
var SpmAgent = require('spm-agent')
var Agent = SpmAgent.Agent
var config = SpmAgent.Config
var logger = SpmAgent.Logger

var http = require('http')
var https = require('https')

var os = require('os')
var Measured = require('measured')

var path = require ('path')

module.exports = function httpServerAgent() {
    var mainScript = path.basename(process.mainModule.filename||'unknown'),
        stats = Measured.createCollection(),
        histogram = new Measured.Histogram(),
        resSize = 0,
        reqSize = 0

    var hAgent = new Agent(
        {

            start: function (agent) {
                this._agent = agent
                resSize = 0
                reqSize = 0
                function monitorHttp(req, res) {
                    try {
                        res._start = new Date().getTime()
                        var endOfConnectionHandler = function () {
                            var end = new Date().getTime()
                            var diff = end - res._start
                            stats.meter('requestsPerSecond').mark();
                            histogram.update(diff, end)
                            if (res.getHeader)
                                resSize +=  ((res.getHeader ('Content-Length')||0)*1)
                            if (req.headers)
                                reqSize +=  (req.headers ['content-length'] || 0) * 1
                            if (res.statusCode >= 300) {
                                stats.meter('errRate').mark()
                                if (res.statusCode < 400) {
                                    stats.meter('3xxRate').mark()
                                } else if (res.statusCode < 500) {
                                    stats.meter('4xxRate').mark()
                                } else if (res.statusCode >= 500) {
                                    stats.meter('5xxRate').mark()
                                }
                            }
                            res.removeListener('finish', endOfConnectionHandler)
                            res.removeListener('close', endOfConnectionHandler)
                        }
                        res.on('finish', endOfConnectionHandler)
                        res.on('close', endOfConnectionHandler)
                    } catch (ex) {
                        logger.error(ex)
                    }
                }
                patchHttpServer(monitorHttp)
                patchHttpsServer(monitorHttp)
                var timerId = setInterval(function () {
                    var counter = 0
                    var httpStats = stats.toJSON()
                    var errRate = httpStats['errRate']
                    var responseTimes = histogram.toJSON()
                    var now = new Date().getTime()

                    // http.requestRate (float), http.errorRate (float), http.3xx (float) , http.4xx (float), http. 5xxRate (float), , reqSize (long), resSize (long), responseTimeMin (float), responseTimeMax(float), responseTime (float)
                    var metricValue = [
                        httpStats ['requestsPerSecond'] ? httpStats ['requestsPerSecond'].count : 0,  // http.requestRate
                        httpStats ['errRate'] ? httpStats ['errRate'].count : 0,                      // http.errorCount (int)
                        httpStats ['3xxRate'] ? httpStats ['3xxRate'].count : 0,                      // http.3xx (int)
                        httpStats ['4xxRate'] ? httpStats ['4xxRate'].count : 0,                      // http.4xx (int)
                        httpStats ['5xxRate'] ? httpStats ['5xxRate'].count : 0,                      // http.5xx (int)
                        reqSize,
                        resSize,
                        responseTimes.min,
                        responseTimes.max,
                        responseTimes.sum
                    ]
                    if (metricValue[0] > 0 || metricValue[1] > 0)
                        agent.addMetrics({ts: now, name: 'http', value: metricValue })


                    stats = Measured.createCollection()
                    histogram.reset()
                }, config.collectionInterval)
                if (timerId.unref)
                    timerId.unref()
            }
        })
    return hAgent

}

var origHttpCreateServer = http.createServer
var origHttpsCreateServer = https.createServer
function patchHttpServer(monitorReqHandler) {
     http.createServer = function (original) {
        var server = null
        if (original)
            server = origHttpCreateServer(original)
        else   {
            server = origHttpCreateServer()
        }
        server.on ('request', monitorReqHandler)
        return server
    }
}
function patchHttpsServer(monitorReqHandler) {
  https.createServer = function (original) {
    var server = null
    if (original)
      server = origHttpCreateServer(original)
    else   {
      server = origHttpCreateServer()
    }
    server.on ('request', monitorReqHandler)
    return server
  }
}
function unpatchHttpServer(newReqHandler) {
    http.createServer = origHttpCreateServer
}

//module.exports.unpatchHttpServer = unpatchHttpServer