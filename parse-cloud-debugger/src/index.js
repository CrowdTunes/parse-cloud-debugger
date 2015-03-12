/*
 Simulate Parse restrictions
 */
(function () {

    var unsupportedParseFunctions = [
        {
            functionName: 'setTimeout',
            message     : "Error : 'setTimeout' is not supported on Parse Cloud ! Use it only locally!"
        },
        {
            functionName: 'setInterval',
            message     : "Error : 'setInterval' is not supported on Parse Cloud ! Use it only locally!"
        }
    ];

    var i, len, functionInfo;

    for (i = 0, len = unsupportedParseFunctions.length; i < len; i++) {
        functionInfo = unsupportedParseFunctions[i];
        (function () {
            var functionName = functionInfo.functionName;
            var message = functionInfo.message;
            var originalFunction = global[functionName];

            global[functionName] = function () {
                console.error(message);
                return originalFunction.apply(this, arguments);
            }
        })();
    }
})();

/*
 Vars && Const
 */
var parseLib = require("./parse-1.3.5.min.js");
var Parse = parseLib.Parse;
var FUNCTION_TIMEOUT = 15;
var JOB_TIMEOUT = 15 * 60;

//_____________________________________________________________________________________________________________________//

/*
 Parse Setup
 */
var oldParseRunFunction = Parse.Cloud.run;

Parse.localFunctions = [];
Parse.jobs = [];

var runFunction = function (callBack, name, timeout, data, options) {
    var request, response;

    options = options || {};

    if (callBack == undefined) {
        console.log("Unable to run function '" + name + "'. Function is not defined !");
        return;
    }

    request = {};
    request.body = {};
    request.params = data;
    request.user = Parse.User.current();

    response = {};
    response.success = options.success;
    response.error = options.error;

    (function runCallBack() {
        var functionName = name;
        var startTime = new Date();
        var endTime;

        callBack(request, {
            success: function (data) {
                endTime = new Date();
                if ((endTime.getTime() - startTime.getTime()) / 1000 >= timeout) {
                    console.error("Function '" + functionName + "' timeout! ");
                }

                if (response.success != undefined) {
                    response.success(data);
                }
            },
            error  : function (error) {
                if (response.error != undefined) {
                    response.error(error);
                }
            }
        });
    })();

}

Parse.Cloud.run = function (name, data, options) {
    //go to real Parse server
    if (options.useParse) {
        oldParseRunFunction(name, data, options);
        return;
    }

    //else call run the function locally
    runFunction(Parse.localFunctions[name], name, FUNCTION_TIMEOUT, data, options);
}


Parse.Cloud.runJob = function (name, data, options) {
    //helper function to run run jobs locally
    runFunction(Parse.jobs[name], name, JOB_TIMEOUT, data, options);
}

Parse.Cloud.beforeSave = Parse.Cloud.afterSave = Parse.Cloud.beforeDelete = Parse.Cloud.afterDelete = function () {
    console.log("This function is not available on client !");
}

Parse.Cloud.httpRequest = function (options) {
    var request = require('request');

    var requestOptions = {
        "url"    : options.url,
        "headers": options.headers || {},
        "params" : options.params || {},
        "method" : options.method || "GET"
    };
    if (typeof options.body == 'object') {
    	requestOptions['formData'] = options.body;
    }
    else if (typeof options.body == 'string') {
    	requestOptions['body'] = options.body;
    }

    var callback = function (error, response, body) {
    	var data;
    	try {
    		data = JSON.parse(body);
    	} catch (e) {
    		// no-op
    	}
        var result = {
            "headers": response.headers,
            "text"   : body,
            "status" : response.statusCode,
            "cookies": {},
            "data"   : data,
            "buffer" : {}
        };

        options = options || {};

        if (error && options.error != undefined) {
            options.error(error);
            return;
        }

        if (options.success != undefined) {
            options.success(result);
        }
    }

    request(requestOptions, callback);
}

Parse.Cloud.define = function (functionName, callBack) {
    Parse.localFunctions[functionName] = callBack;
}

Parse.Cloud.job = function (jobName, callBack) {
    Parse.jobs[jobName] = callBack;
}


//_____________________________________________________________________________________________________________________//

/*
 Local Debugging Server Setup
 */
var parseRawBody = function (req, res, next) {
    req.setEncoding('utf8');
    req.rawBody = '';
    req.on('data', function (chunk) {
        req.rawBody += chunk;
    });
    req.on('end', function () {
        req.body = JSON.parse(req.rawBody);
        next();
    });
}


var reqHandler = function (req, res) {
    var name = req.params.name;
    var type = req.params.type;
    var func = Parse.Cloud.run;

    if (type == 'jobs') {
        func = Parse.Cloud.runJob;
    }

    try {
        func(name, req.body, {
            success: function (data) {
                res.header("Access-Control-Allow-Origin", "*");
                res.header("Access-Control-Request-Headers", "X-Requested-With, accept, content-type");
                res.header("Access-Control-Allow-Methods", "GET, POST");
                res.send({result: data});
            },
            error  : function (err) {
                res.send(err);
            }
        });
    }
    catch (e) {
        res.send(e);
    }
};

var express = require('express');
var app = express();

app.set('port', process.env.PORT || 5555);
app.use(express.bodyParser());
app.use(parseRawBody);


app.post('/:type/:name', reqHandler);
app.post('/1/:type/:name', reqHandler);

var debugServer = app.listen(app.get('port'), function () {
    console.error('Local Parse Cloud running at port ' + app.get('port') + '...');
});


module.exports = parseLib;