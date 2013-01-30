/**
 * Backbone fileSystem Adapter
 * Version 0.1
 *
 * https://github.com/scotthovestadt
 */
(function (root, factory) {
   if (typeof define === "function" && define.amd) {
      // AMD. Register as an anonymous module.
      define(["underscore","backbone","jquery"], function(_, Backbone, jQuery) {
        // Use global variables if the locals is undefined.
        return factory(_ || root._, Backbone || root.Backbone, jQuery || root.jQuery);
      });
   } else {
      // RequireJS isn't being used. Assume underscore and backbone is loaded in <script> tags
      factory(_, Backbone, jQuery);
   }
}(this, function(_, Backbone, $) {
// A simple module to replace "Backbone.sync" with fileSystem-based persistence. Models are given GUIDS, and saved into a JSON object.

// Initialize with namespace
Backbone.FileSystem = window.Store = function(name) {
  this.name = name;
  // TODO: Take "quota" and "type" -- https://developers.google.com/chrome/whitepapers/storage
}

// Generate four random hex digits.
function S4() {
  return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
}

// Generate a pseudo-GUID by concatenating random hexadecimal.
function guid() {
  return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

// Request access to and return handle for cache directory
// All cache files are namespaced by saving them into a particular directory
// Directory entries are cached on var dirEntry. The cached value is returned if present.
var dirEntry = {};
function getDirectoryEntry(directory) {
  var Deferred = $.Deferred();
  if(dirEntry[directory] === undefined) {
    window.webkitStorageInfo.requestQuota(PERSISTENT, 1024*1024, function(grantedBytes) {
      window.webkitRequestFileSystem(PERSISTENT, grantedBytes, function(fs) {
        fs.root.getDirectory(directory, {create: true, exclusive: false}, function(de) {
          dirEntry[directory] = de;
          Deferred.resolve(de);
        }, Deferred.reject);
      }, Deferred.reject);
    }, Deferred.reject);
  } else {
    Deferred.resolve(dirEntry[directory]);
  }
  return Deferred.promise();
}

// Get model JSON
function getModel(id, directory) {
  var Deferred = $.Deferred();
  getDirectoryEntry(directory).done(function(dirEntry) {
    dirEntry.getFile(id, {create: false, exclusive: false}, function(fileEntry) {
      fileEntry.file(function(file) {
        var reader = new FileReader();
        reader.onloadend = function(e) {
          // Attempt to parse JSON
          var model, ex;
          try {
            model = $.parseJSON(e.currentTarget.result);
          } catch(exception) {
            ex = exception;
          }

          // Cannot call resolve/reject within try/catch or we'll catch unrelated exceptions
          if(model) {
            Deferred.resolve(model);
          } else {
            Deferred.reject(ex);
          }
        }
        reader.onerror = Deferred.reject;
        reader.readAsText(file);
      });
    });
  }).fail(Deferred.reject);
  return Deferred.promise(); 
}

// Get all model JSON in array
function getAllModels(directory) {
  var promises = [];
  var Deferred = $.Deferred();
  getDirectoryEntry(directory).done(function(dirEntry) {
    var dirReader = dirEntry.createReader();
    dirReader.readEntries(function(fileEntries) {
      var models = [];
      _.each(fileEntries, function(fileEntry) {
        if(fileEntry.isFile) {
          promises.push(getModel(fileEntry.name, directory).done(function(model) {
            // If successful, push into array
            models.push(model);
          }).fail(function(e) {
            // Ignore individual failure
          }));
        }
      });
      $.when.apply($, promises).always(function() {
        models = _.compact(models);
        Deferred.resolve(models);
      });
    }, Deferred.reject);
  }).fail(Deferred.reject);
  return Deferred.promise();
}

// Save model JSON
function saveModel(model, directory) {
  var Deferred = $.Deferred();
  getDirectoryEntry(directory).done(function(dirEntry) {
    dirEntry.getFile(model.id, {create: true, exclusive: false}, function(fileEntry) {
      fileEntry.createWriter(function(fileWriter) {
        fileWriter.onwriteend = function() {
          Deferred.resolve(model);
        }
        fileWriter.onerror = Deferred.reject;
        var json = JSON.stringify(model, null, 2); // Forcing it not to be one very long line seems to reduce instances of cache corruption
        var toWrite = new Blob([json], {type: 'text/plain'});
        fileWriter.write(toWrite);
      });
    }, Deferred.reject);
  }).fail(Deferred.reject);
  return Deferred.promise(); 
}

// Delete model
function deleteModel(id, directory) {
  var Deferred = $.Deferred();
  getDirectoryEntry(directory).done(function(dirEntry) {
    dirEntry.getFile(id, {create: false}, function(fileEntry) {
      fileEntry.remove(Deferred.resolve, Deferred.reject);
    }, Deferred.reject);
  }).fail(Deferred.reject);
  return Deferred;
}

// Implement the 4 methods of the Backbone.sync interface
_.extend(Backbone.FileSystem.prototype, {
  // Retrieve model
  read: function(model) {
    if(model.id !== undefined) {
      return getModel(model.id, this.name);
    } else {
      return getAllModels(this.name);
    }
  },

  // Add a model, giving it a (hopefully)-unique GUID, if it doesn't already have an id of it's own
  create: function(model) {
    if (!model.id) {
      model.id = guid();
      model.set(model.idAttribute, model.id);
    }
    return saveModel(model, this.name);
  },

  // Update model
  update: function(model) {
    if(!model.id) {
      throw "Cannot update model without ID";
    }
    return this.create(model, this.name);
  },

  // Delete model
  delete: function(model) {
    if(model.isNew()) {
      return false;
    }
    return deleteModel(model.id, this.name);
  }
});

// Implementation of Backbone.sync
Backbone.FileSystem.sync = window.Store.sync = Backbone.localSync = function(method, model, options) {
  var store = model.fileSystem || model.collection.fileSystem;

  // Proxy to Backbone.FileSystem
  // Always return Deferred promise (jQuery)
  var promise;
  switch (method) {
    case "read":
      promise = store.read(model);
    break;
    
    case "create":
      promise = store.create(model);
    break;

    case "update":
      promise = store.update(model);
    break;

    case "delete":
      promise = store.delete(model);
    break;
  }

  // Must fire either success or fail
  if(options && options.success) {
    promise.done(function(resp) {
      options.success(model, resp, options);
    });
  }
  if(options && options.error) {
    promise.fail(function(error) {
      options.error(model, promise, options);
    });
  }

  // Return promise
  return promise;
};

// Store original reference to Backbone.sync before overriding it
Backbone.ajaxSync = Backbone.sync;

// If model attribute fileSystem = true, this adapter is used
// Otherwise, default to Backbone.sync
Backbone.getSyncMethod = function(model) {
  return (model.fileSystem || (model.collection && model.collection.fileSystem)) ? Backbone.localSync : Backbone.ajaxSync;
};

// Override 'Backbone.sync' to default to localSync,
// the original 'Backbone.sync' is still available in 'Backbone.ajaxSync'
Backbone.sync = function(method, model, options) {
  return Backbone.getSyncMethod(model).apply(this, [method, model, options]);
};

return Backbone.FileSystem;
}));
