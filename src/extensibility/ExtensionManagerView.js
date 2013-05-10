/*
 * Copyright (c) 2013 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50, regexp: true */
/*global define, window, $, brackets, Mustache */
/*unittests: ExtensionManager*/

define(function (require, exports, module) {
    "use strict";
    
    var Strings                   = require("strings"),
        NativeApp                 = require("utils/NativeApp"),
        ExtensionManagerViewModel = require("extensibility/ExtensionManagerViewModel").ExtensionManagerViewModel,
        ExtensionManager          = require("extensibility/ExtensionManager"),
        registry_utils            = require("extensibility/registry_utils"),
        InstallExtensionDialog    = require("extensibility/InstallExtensionDialog"),
        itemTemplate              = require("text!htmlContent/extension-manager-view-item.html");
    
    /**
     * @constructor
     * Creates a view enabling the user to install and manage extensions. Must be initialized
     * with initialize(). When the view is closed, dispose() must be called.
     */
    function ExtensionManagerView() {
    }
    
    /**
     * Initializes the view to show a set of extensions.
     * @param {string} source Which set of extensions to view: one of the SOURCE_* constants
     *     in ExtensionsManagerViewModel.
     * @return {$.Promise} a promise that's resolved once the view has been initialized. Never
     *     rejected.
     */
    ExtensionManagerView.prototype.initialize = function (source) {
        var self = this,
            result = new $.Deferred();
        this.model = new ExtensionManagerViewModel();
        this._itemTemplate = Mustache.compile(itemTemplate);
        this._itemViews = {};
        this.$el = $("<div class='extension-list'/>");
        this._$table = $("<table class='table'/>").appendTo(this.$el);
        
        // Show the busy spinner and access the registry.
        var $spinner = $("<div class='spinner large spin'/>")
            .appendTo(this.$el);
        this.model.initialize(source).done(function () {
            self._setupEventHandlers();
            self._render();
        }).fail(function () {
            $("<div class='alert-message error load-error'/>")
                .text(Strings.EXTENSION_MANAGER_ERROR_LOAD)
                .appendTo(self.$el);
        }).always(function () {
            $spinner.remove();
            result.resolve();
        });
        return result.promise();
    };
    
    /**
     * @type {jQueryObject}
     * The root of the view's DOM tree.
     */
    ExtensionManagerView.prototype.$el = null;
    
    /**
     * @type {Model}
     * The view's model. Handles sorting and filtering of items in the view.
     */
    ExtensionManagerView.prototype.model = null;
    
    /**
     * @private
     * @type {jQueryObject}
     * The root of the table inside the view.
     */
    ExtensionManagerView.prototype._$table = null;
    
    /**
     * @private
     * @type {function} The compiled template we use for rendering items in the extension list.
     */
    ExtensionManagerView.prototype._itemTemplate = null;
    
    /**
     * @private
     * @type {Object.<string, jQueryObject>}
     * The individual views for each item, keyed by the extension ID.
     */
    ExtensionManagerView.prototype._itemViews = null;
    
    /**
     * @private
     * Attaches our event handlers. We wait to do this until we've fully fetched the extension list.
     */
    ExtensionManagerView.prototype._setupEventHandlers = function () {
        var self = this;
        
        // Listen for model data and filter changes.
        $(this.model)
            .on("filter", function () {
                self._render();
            })
            .on("change", function (e, id) {
                // Re-render the extension item.
                var extensions = self.model.extensions;
                if (extensions[id]) {
                    var $oldItem = self._itemViews[id],
                        $newItem = self._renderItem(extensions[id]);
                    if ($oldItem) {
                        $oldItem.replaceWith($newItem);
                        self._itemViews[id] = $newItem;
                    }
                }
            });
        
        // UI event handlers
        $(this.$el)
            // Intercept clicks on external links to open in the native browser.
            .on("click", "a", function (e) {
                e.stopImmediatePropagation();
                e.preventDefault();
                NativeApp.openURLInDefaultBrowser($(e.target).attr("href"));
            })
            // Handle install button clicks
            .on("click", "button.install", function (e) {
                // "this" is correct here (it's the button)
                self._installUsingDialog($(this).attr("data-extension-id"));
            });
    };
    
    /**
     * @private
     * Renders the view for a single extension entry.
     * @param {Object} entry The extension entry to render.
     * @return {jQueryObject} The rendered node as a jQuery object.
     */
    ExtensionManagerView.prototype._renderItem = function (entry) {
        // Create a Mustache context object containing the entry data and our helper functions.
        var info, context;
        if (this.model.source === ExtensionManagerViewModel.SOURCE_INSTALLED) {
            info = entry.installInfo;
            context = $.extend({}, info);
            // If this is also linked to a registry item, copy over the owner info.
            if (entry.registryInfo) {
                context.owner = entry.registryInfo.owner;
            }
        } else {
            info = entry.registryInfo;
            context = $.extend({}, info);
        }
        
        // Normally we would merge the strings into the context we're passing into the template,
        // but since we're instantiating the template for every item, it seems wrong to take the hit
        // of copying all the strings into the context, so we just make it a subfield.
        context.Strings = Strings;
        
        context.isInstalled = !!entry.installInfo;
        context.hasVersionInfo = !!info.versions;
                
        // TODO: calculate this in ExtensionManager and store it?
        var compatInfo = ExtensionManager.getCompatibilityInfo(info, brackets.metadata.apiVersion);
        context.isCompatible = compatInfo.isCompatible;
        context.requiresNewer = compatInfo.requiresNewer;
        
        context.showInstallButton = (this.model.source === ExtensionManagerViewModel.SOURCE_REGISTRY);
        context.allowInstall = context.isCompatible && !context.isInstalled;
        
        context.allowRemove = (entry.installInfo && entry.installInfo.locationType === ExtensionManager.LOCATION_USER);
        
        ["lastVersionDate", "ownerLink", "formatUserId"].forEach(function (helper) {
            context[helper] = registry_utils[helper];
        });
        
        context.authorInfo = function () {
            var result = "",
                ownerLink = context.ownerLink.call(this),
                userId = context.formatUserId.call(this);
            if (this.metadata && this.metadata.author && this.metadata.author.name) {
                result += this.metadata.author.name;
            }
            if (userId) {
                if (result !== "") {
                    result += " / ";
                }
                result += "<a href='" + ownerLink + "'>" + userId + "</a>";
            }
            return result;
        };

        return $(this._itemTemplate(context));
    };
    
    /**
     * @private
     * Renders the extension entries in the model's current filter list.
     */
    ExtensionManagerView.prototype._render = function () {
        var self = this,
            $item;
        this._$table.empty();
        this.model.filterSet.forEach(function (id) {
            var $item = self._itemViews[id];
            if (!$item) {
                $item = self._renderItem(self.model.extensions[id]);
                self._itemViews[id] = $item;
            }
            $item.appendTo(self._$table);
        });
        $(this).triggerHandler("render");
    };
    
    /**
     * @private
     * Install the extension with the given ID using the install dialog.
     * @param {string} id ID of the extension to install.
     */
    ExtensionManagerView.prototype._installUsingDialog = function (id) {
        var entry = this.model.extensions[id];
        if (entry && entry.registryInfo) {
            var url = ExtensionManager.getExtensionURL(id, entry.registryInfo.metadata.version);
            InstallExtensionDialog.installUsingDialog(url);
        }
    };
    
    /**
     * Filters the contents of the view.
     * @param {string} query The query to filter by.
     */
    ExtensionManagerView.prototype.filter = function (query) {
        this.model.filter(query);
    };
    
    /**
     * Disposes the view. Must be called when the view goes away.
     */
    ExtensionManagerView.prototype.dispose = function () {
        this.model.dispose();
    };
    
    exports.ExtensionManagerView = ExtensionManagerView;
});