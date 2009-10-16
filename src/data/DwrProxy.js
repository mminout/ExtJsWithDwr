Ext.namespace("Ext.ux.data");

/**
 * @class Ext.ux.data.DwrProxy
 * @extends Ext.data.DataProxy
 * @author loeppky
 * An implementation of Ext.data.DataProxy that uses DWR to make a remote call.
 * Note that not all of Ext.data.DataProxy's configuration options make sense for Ext.ux.data.DwrProxy.
 * The following constructor sample code contains all the available options that can be set:
 * <code><pre>
 *	new Ext.ux.data.DwrProxy({
 *		// Defined by Ext.data.DataProxy
 *		apiActionToHanderMap : {
 *			read : {
 * 				dwrFunction : DwrInterface.read,
 *				// Define a custom function that passes the paging parameters to DWR.
 *				getDwrArgsFunction : function(request) {
 *					var pagingParamNames = this.store.paramNames;
 *					var params = request.params;
 *					return [params[pagingParamNames.start], params[pagingParamNames.limit]];
 *				},
 *				// The scope is set to "this" so that this store's paging parameter names can be accessed.
 *				getDwrArgsScope : this
 *			},
 *			// These aren't needed if only doing reading.
 *			create : {
 *				// Use the default function which will set the DWR args to an array of all the objects to create.
 *				dwrFunction : DwrInterface.create
 *			}, 
 *			update : {
 *				dwrFunction : DwrInterface.update
 *			}, 
 *			destroy : {
 *				dwrFunction : DwrInterface.destroy,
 *				// Define a custom function to pass a login and password, in addition to the objects to delete.
 *				getDwrArgsFunction : function(request, recordDataArray) {
 *					return [recordDataArray, this.login, this.password];
 *				}
 *				getDwrArgsScope : this
 *			}
 *		}
 *	});
 * </pre></code> 
 * @constructor
 * @param {Object} config The config object.
 */
Ext.ux.data.DwrProxy = function(config) {
	
	if (!config || !config.apiActionToHandlerMap) {
		throw new Exception('"apiActionToHandlerMap" is not defined within config.');
	}
	
	// Construct Ext.ux.data.DwrProxy.ActionHandlers from any configs objects.
	this.apiActionToHandlerMap = {};
	Ext.iterate(Ext.data.Api.actions, function(action) {
		var actionHandlerConfig = config.apiActionToHandlerMap[action];
		if (actionHandlerConfig) {
			actionHandlerConfig.action = action;
			this.apiActionToHandlerMap[action] = new Ext.ux.data.DwrProxy.ActionHandler(actionHandlerConfig);
		}
	}, this);
	
	// Ext.data.DataProxy requires that an API action be defined under the "api" key.
	// If it isn't, an Ext.data.DataProxy.Error is thrown.
	// To avoid this, api is set to apiActionToHandlerMap since they share the same keys ("create", "read", "update", and "destroy").
	config.api = this.apiActionToHandlerMap;

	Ext.ux.data.DwrProxy.superclass.constructor.call(this, config);
};
Ext.extend(Ext.ux.data.DwrProxy, Ext.data.DataProxy, {
	
	/**
	 * @cfg {Object} apiActionToHandlerMap.
	 * A map of {@link Ext.data.Api} actions to corresponding {@link Ext.ux.data.DwrProxy.ActionHandler}s.
	 * Note: this option is very similar to {@link Ext.data.DataProxy#api}, but since the values need to be different, 
	 * this new option is created so as not to create confusion.  The name of this option is also more clear.
	 */
	apiActionToHandlerMap : {},
	
	/**
	 * DwrProxy implementation of {@link Ext.data.DataProxy#doRequest}.
	 * This implementation attempts to mirror {@link Ext.data.HttpProxy#doRequest} as much as possible.
	 * The getDwrArgsFunction is called for the corresponding action, 
	 * and then a request is made for the dwrFunction that corresponds with the provided action.
	 * See {@link Ext.data.DataProxy#request} for the parameter descriptions.
	 * @private
	 */
	doRequest : function(action, records, params, reader, callback, scope, options) {
		var request = new Ext.ux.data.DataProxy.Request(action, records, params, reader, callback, scope, options);
		var apiActionHandler = this.apiActionToHandlerMap[action];
		if (!apiActionHandler) {
			throw new Exception('No API Action Handler defined for action: ' + action);
		}
		
		var dwrArgs = apiActionHandler.getDwrArgsFunction.call(apiActionHandler.getDwrArgsScope, request, this.getRecordDataArray(records)) || [];
		dwrArgs.push(this.createCallback(request));
		apiActionHandler.dwrFunction.apply(Object, dwrArgs); // the scope for calling the dwrFunction doesn't matter, so we simply set it to Object.
	},
	
	/**
	 * @param {Ext.data.Record[]} records The {@link Ext.data.Record}s to pull the data out of.
	 * @return {Object[]} Array containing the result of {@link Ext.data.Record#data} for each {@link Ext.data.Record}.
	 * This is used so the raw {@link Ext.data.Record}s are not sent to DWR, since they have fields the DWR DTO won't be expecting.
	 */
	getRecordDataArray : function(records) {
		return Ext.pluck(records, 'data');
	},
	
	/**
	 * Helper method for doRequest which returns a callback function for a DWR request.
	 * The returned callback function in turn invokes the callback function within the provided {Ext.ux.data.DataProxy.Request}.
	 * This mirrors HttpProxy#createCallsback.
	 * DWR is unique though in that it allows one to define a callback function for success and callback function for an exception.
	 * This exceptionHandler callback parallels Ext's "response exception" case.
	 * This method thus returns two callback functions groupded as a single object that can be appended to the DWR function arguments as required by DWR.
	 * @param {Ext.ux.data.DataProxy.Request} request The arguments passed to {@link #doRequest}.
	 * @private
	 */
	createCallback : function(request) {
		return {
			callback: function(response){
				if (request.action === Ext.data.Api.actions.read) {
					this.onRead(request, response);
				} else {
					this.onWrite(request, response);
				}
			}.createDelegate(this),
			exceptionHandler : function(message, exception) {
				// The event is supposed to pass the response, but since DWR doesn't provide that to us, we pass the message.
				this.handleResponseException(request, message, exception);
			}.createDelegate(this)
		};
	},

	/**
	 * Helper method for createCallback for handling the read action.
	 * After creating records from the provided response, it calls the callback function within the provided {Ext.ux.data.DataProxy.Request}.
	 * This mirrors HttpProxy#onRead.
	 * @param {Ext.ux.data.DataProxy.Request} request The arguments passed to {@link #doRequest}.
	 * @param {Object} response The response from the DWR call.  This should be an Object which can be converted to {@link Ext.data.Records}.
	 * @private
	 */
	onRead : function(request, response) {
		var readDataBlock;
		try {
			// Call readRecords() instead of read because read() will attempt to decode JSON to create an Object,
			// but as this point DWR has already created an Object.
			readDataBlock = request.reader.readRecords(response);
		} catch(e) {
			return this.handleResponseException(request, message, e);
		}
		var success = readDataBlock[request.reader.meta.successProperty];
		if (success === false) {
			this.fireEvent("exception", this, 'remote', request.action, request.options, response, null);
		} else {
			this.fireEvent("load", this, request, request.options);
		}
		request.callback.call(request.scope, readDataBlock, request.options, success);
	},
	
	/**
	 * Helper method for createCallback for handling the create, update, and delete actions.
	 * This mirrors HttpProxy#onWrite
	 * @param {Ext.ux.data.DataProxy.Request} request The arguments passed to {@link #doRequest}.
	 * @param {Object} response The response from the DWR call.  This should be an Object which can be converted to {@link Ext.data.Records}.
	 * @private
	 */
	onWrite : function(request, response) {
		var readDataBlock;
		try {
			readDataBlock = request.reader.readResponse(request.action, response);
		} catch (e) {
			return this.handleResponseException(request, message, e);
		}
		var success = readDataBlock[request.reader.meta.successProperty];
		var readRecords = readDataBlock[request.reader.meta.root];
		if (success === false) {
			this.fireEvent("exception", this, 'remote', request.action, request.options, response, request.records);
		} else {
			this.fireEvent("write", this, request.action, readRecords, readDataBlock, request.records, request.options);
		}
		request.callback.call(request.scope, readRecords, response, success);
	},
	
	/**
	 * @param {Ext.ux.data.DataProxy.Request} request The arguments passed to {@link #doRequest}.
	 * @param {Object} response The response from the DWR call.
	 * @param {Object} exception Exception that was thrown processing the request.
	 */
	handleResponseException : function(request, response, exception) {
		this.fireEvent("exception", this, 'response', request.action, request.options, response, exception);
		request.callback.call(request.scope, null, request.options, false);
	}
});

/**
 * @class Ext.ux.data.DwrProxy.ActionHandler
 * Encapsulates the parameters passed to {@link Ext.data.DataProxy#request}.
 * @constructor
 * @param {Object} config The config object.
 * @cfg {String} action [Required] The {@link Ext.data.Api} action this handler is for.
 * @cfg {Function} dwrFunction [Required] The DWR-generated function to call for the action. 
 * @cfg {Function} getDwrArgsFunction [Optional] Function to call to generate the arguments for the dwrFunction.
 * This {@link Function} will be passed a {@link Ext.ux.data.DataProxy.Request},
 * and if it's a write action, also the {@link Ext.data.Record#data}s to write.
 * The getDwrArgsFunction must return an Array of arguments in the order needed by the dwrFunction.
 * This class will generate the DWR callback function (the final argument passed to the dwrFunction).
 * If no getDwrArgsFunction is defined, then for the read case no arguments will be passed to the dwrFunction (see {@link #defaultGetDwrArgsFunctionForRead}).
 * In the write case, the array of {@link Ext.data.Record#data} will be passed (see {@link #defaultGetDwrArgsFunctionForWrite}).
 * @cfg {Object} getDwrArgsScope [Optional] The scope to execute getDwrArgsFunction.  Defaults to "Object".
 */
Ext.ux.data.DwrProxy.ActionHandler = function(config) {
	Ext.apply(this, config);
	if (!this.action) {
		throw new Exception('"action" is not defined.');
	}
	if (!Ext.data.Api.isAction(this.action)) {
		throw new Exception(this.action + ' is not a valid Ext.data.Api action.');
	}
	if (!this.dwrFunction) {
		throw new Exception('"dwrFunction" is not defined.');
	}
	if (!this.getDwrArgsFunction) {
		if (this.action === Ext.data.Api.actions.read) {
			this.getDwrArgsFunction = this.defaultGetDwrArgsFunctions.read;
		} else {
			this.getDwrArgsFunction = this.defaultGetDwrArgsFunctions.write;
		}
	}
	if (!this.getDwrArgsScope) {
		this.getDwrArgsScope = Object;
	}
};
Ext.extend(Ext.ux.data.DwrProxy.ActionHandler, Object, {
	
	/*
	 * Private properties
	 */
	defaultGetDwrArgsFunctions : {
		/**
		 * @return {Array} Empty array, meaning no arguments are passed to the read dwrFunction.
		 * @private
		 */
		read : function() {
			return [];
		},
		
		/**
		 * @param {Ext.ux.data.DataProxy.Request} request
		 * @param {Array} recordDataArray Array of {@link Ext.data.Record#data} to write.
		 * @return {Object[]} The recordDataArray wrapped in an array so the dwrFunction will send one parameter: a list of {@link Ext.data.Record#data}s. 
		 * @private
		 */
		write : function(request, recordDataArray) {
			return [recordDataArray];
		}
	}
});

Ext.namespace("Ext.ux.data.DataProxy");
/**
 * @class Ext.ux.data.DataProxy.Request
 * Encapsulates the parameters passed to {@link Ext.data.DataProxy#request}.
 * @constructor
 * @param {String} action The crud action type (create, read, update, destroy).  Note: only "read" is currently supported.
 * @param {Ext.data.Record/Ext.data.Record[]} records If action is "read", records will be null.
 * @param {Object} params An object containing properties which are to be used as parameters for the request to the remote server.
 * @param {Ext.data.DataReader} reader The {@link Ext.data.DataReader} object which converts the server response into a "readDataBlock" (the result from calling {@link Ext.data.DataReader#read}).
 * @param {Function} callback A function to be called after the request.
 * The callback is passed the following arguments:<ul>
 * <li>readDataBlock: Data object from calling {@link Ext.data.DataReader#read}.</li>
 * <li>options: The options object (see below)</li>
 * <li>success: Boolean success indicator.</li>
 * </ul>
 * @param {Object} scope The scope in which to call the callback.
 * @param {Object} options An optional argument which is passed to the callback as its second parameter.
 */
Ext.ux.data.DataProxy.Request = function(action, records, params, reader, callback, scope, options) {
	Ext.apply(this, {
		action : action,
		records : records,
		params : params,
		reader: reader,
		callback : callback,
		scope : scope,
		options : options
	});
};