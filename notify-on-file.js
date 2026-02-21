// VS Code API and Node.js path module
const vscode = require('vscode');
const path = require('path');

// ── Utility helpers ────────────────────────────────────────────────────────────

// Returns obj[prop] if it exists, otherwise returns deflt.
// Safer than obj[prop] because it won't return inherited prototype properties.
function getProperty(obj, prop, deflt) { return obj.hasOwnProperty(prop) ? obj[prop] : deflt; }

// Type-check helpers. Note: in JavaScript typeof [] === 'object', so isObject
// explicitly excludes arrays to avoid confusion.
function isString(obj) { return typeof obj === 'string'; }
function isArray(obj)  { return Array.isArray(obj); }
function isObject(obj) { return (typeof obj === 'object') && !isArray(obj); }

// Like the ?? (nullish coalescing) operator: returns value if not undefined,
// otherwise returns deflt.
function dblQuest(value, deflt) { return value !== undefined ? value : deflt; }

// Shows a VS Code error popup and returns noObject (or "Unknown" as fallback).
// Used as a combined error-report + safe-return-value helper.
function errorMessage(msg, noObject) { vscode.window.showErrorMessage(msg); return noObject ? noObject : "Unknown"; }

// The configuration key prefix used in settings.json ("notify-on-file.*")
const extensionShortName = 'notify-on-file';

// ── Variable substitution engine ───────────────────────────────────────────────
//
// VS Code extensions support ${variable} placeholders in config strings,
// similar to how VS Code tasks and launch configs work.
// The functions below implement that substitution for this extension.

/** @callback ReplaceCB */
/**
 * Replaces all occurrences of ${variableRegex} in text using the given replacement.
 * @param {string} text            - Input string that may contain ${...} placeholders.
 * @param {string} variableRegex   - Regex pattern for the variable name inside ${...}.
 * @param {number} capGroupCount   - Number of capture groups in variableRegex.
 * @param {string | ReplaceCB} replacement - Fixed string or a function(match, ...groups) => string.
 */
function variableReplace(text, variableRegex, capGroupCount, replacement) {
  // Build a regex that matches ${variableRegex}, e.g. /\$\{relativeFile\}/g
  let varRE = new RegExp(`\\$\\{${variableRegex}\\}`, 'g');
  text = text.replace(varRE, (m, ...ppp) => {
    // ppp contains: [cap1, cap2, ..., offset, fullString, namedGroups]
    // We only want the actual capture groups (capGroupCount of them).
    ppp.splice(capGroupCount);
    // Prepend the full match so the callback signature is (match, cap1, cap2, ...)
    ppp.unshift(m);
    return typeof replacement === 'string' ? replacement : replacement.apply(null, ppp);
  });
  return text;
}

/**
 * Finds the workspace folder that contains the given URI.
 * In a multi-root workspace there can be several folders open at once;
 * this function picks the right one (or the first one in single-root mode).
 * Then calls action(workspaceFolder) and returns its result.
 */
function URIWorkspaceFolder(uri, action) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return errorMessage('No folder open'); }
  let wsf = undefined;
  if (folders.length > 1) {
    // Multi-root: we need a URI to determine which folder the file belongs to.
    if (!uri) { return errorMessage('Use the name of the Workspace Folder'); }
    wsf = vscode.workspace.getWorkspaceFolder(uri);
  }
  if (!wsf) {
    // Single-root (or fallback): just use the first (and only) folder.
    wsf = folders[0];
  }
  return action(wsf);
}

/**
 * Looks up a workspace folder by name (used for ${workspaceFolder:Name} syntax).
 * Also supports path-suffix matching if name contains '/'.
 */
function getNamedWorkspaceFolder(name) {
  const folders = dblQuest(vscode.workspace.workspaceFolders, []);
  let filterPred = w => w.name === name;
  if (name.indexOf('/') >= 0) { filterPred = w => w.uri.path.endsWith(name); }
  let wsfLst = folders.filter(filterPred);
  if (wsfLst.length === 0) {
    errorMessage(`Workspace not found with name: ${name}`);
    return undefined;
  }
  return wsfLst[0];
}

/**
 * Resolves "file-independent" variables synchronously.
 * These don't need a specific file URI – they depend only on the OS and workspace.
 *
 * Supported: ${pathSeparator}, ${userHome}, ${env:NAME},
 *            ${workspaceFolder}, ${workspaceFolder:Name}, ${workspaceFolderBasename}
 */
function variableSubstitutionSync_1(result, uri) {
  // ${pathSeparator} → \ on Windows, / on Linux/Mac
  result = variableReplace(result, 'pathSeparator', 0, process.platform === 'win32' ? '\\' : '/');

  // ${userHome} → home directory, resolved recursively via env vars
  result = variableReplace(result, 'userHome', 0, m =>
    variableSubstitutionSync_1(
      process.platform === 'win32' ? '${env:HOMEDRIVE}${env:HOMEPATH}' : '${env:HOME}',
      uri
    )
  );

  // ${env:VARNAME} → value of environment variable VARNAME (empty string if missing)
  result = variableReplace(result, 'env:(.+?)', 1, (m, p1) => {
    return getProperty(process.env, p1, '');
  });

  // ${workspaceFolder} → full filesystem path of the workspace root
  result = variableReplace(result, 'workspaceFolder', 0, m => {
    return URIWorkspaceFolder(uri, workspaceFolder => workspaceFolder.uri.fsPath);
  });

  // ${workspaceFolder:Name} → filesystem path of the named workspace root
  result = variableReplace(result, 'workspaceFolder:(.+?)', 1, (m, p1) => {
    let wsf = getNamedWorkspaceFolder(p1);
    if (!wsf) { return 'Unknown'; }
    return wsf.uri.fsPath;
  });

  // ${workspaceFolderBasename} → just the folder name, not the full path
  result = variableReplace(result, 'workspaceFolderBasename', 0, m => {
    return URIWorkspaceFolder(uri, workspaceFolder => path.basename(workspaceFolder.uri.fsPath));
  });

  return result;
}

/**
 * Resolves all variables in text, including file-specific ones.
 * This is async because future variables might need async resolution.
 *
 * Supported (in addition to variableSubstitutionSync_1):
 *   ${file}, ${relativeFile}, ${fileBasename}, ${fileBasenameNoExtension},
 *   ${fileExtname}, ${fileDirname}, ${relativeFileDirname}
 *
 * The inner stringSubstitutionDepthN loop keeps resolving until no ${...}
 * remains – this handles chained variables like ${userHome} → ${env:...} → value.
 */
async function variableSubstitution(text, args, uri) {
  args = dblQuest(args, {});

  // Single pass: resolves one level of variables.
  let stringSubstitution = async (text) => {
    if (!isString(text)) { return text; }
    var result = text;

    // First resolve file-independent variables (OS, env, workspace paths)
    result = variableSubstitutionSync_1(result, uri);
    if (result === undefined) { return undefined; }
    if (!uri) { return result; }  // No file context → nothing more to resolve

    // ${file} → full filesystem path of the current file
    const fileFSPath = uri.fsPath;
    result = variableReplace(result, 'file', 0, fileFSPath);

    // ${relativeFile} → path relative to the workspace root
    const relativeFile = URIWorkspaceFolder(uri, workspaceFolder => {
      const wsfFSPath = workspaceFolder.uri.fsPath;
      if (fileFSPath.startsWith(wsfFSPath)) {
        return fileFSPath.substring(wsfFSPath.length + 1);
      }
      return 'Unknown';
    });
    result = variableReplace(result, 'relativeFile', 0, relativeFile);

    // Split the URI path to extract filename parts
    const filePath = uri.path;
    const lastSep = filePath.lastIndexOf('/');
    if (lastSep === -1) { return result; }

    // ${fileBasename} → filename with extension, e.g. "app.js"
    const fileBasename = filePath.substring(lastSep + 1);
    result = variableReplace(result, 'fileBasename', 0, fileBasename);

    // ${fileBasenameNoExtension} → filename without extension, e.g. "app"
    const lastDot = fileBasename.lastIndexOf('.');
    const fileBasenameNoExtension = lastDot >= 0 ? fileBasename.substring(0, lastDot) : fileBasename;
    result = variableReplace(result, 'fileBasenameNoExtension', 0, fileBasenameNoExtension);

    // ${fileExtname} → extension including the dot, e.g. ".js"
    const fileExtname = lastDot >= 0 ? fileBasename.substring(lastDot) : '';
    result = variableReplace(result, 'fileExtname', 0, fileExtname);

    // ${fileDirname} → directory containing the file (full path)
    let fileDirname = fileFSPath.substring(0, fileFSPath.length - (fileBasename.length + 1));
    result = variableReplace(result, 'fileDirname', 0, fileDirname);

    // ${relativeFileDirname} → directory containing the file (relative to workspace)
    let relativeFileDirname = relativeFile;
    if (relativeFile.endsWith(fileBasename)) {
      relativeFileDirname = relativeFile.substring(0, relativeFile.length - (fileBasename.length + 1));
    }
    result = variableReplace(result, 'relativeFileDirname', 0, relativeFileDirname);

    return result;
  };

  // Multi-pass: keeps substituting until no ${...} placeholders remain.
  // Needed for chained variables, e.g. ${userHome} expands to ${env:HOMEDRIVE}${env:HOMEPATH}
  // which then needs another pass to resolve the env vars.
  let stringSubstitutionDepthN = async (text) => {
    if (!isString(text)) { return text; }
    while (text.indexOf('${') >= 0) {
      let newText = await stringSubstitution(text);
      if (newText === undefined) { return undefined; }
      if (newText === text) { break; }  // No further changes → stop to avoid infinite loop
      text = newText;
    }
    return text;
  };

  return await stringSubstitutionDepthN(text);
}

// ── Status bar item cache ──────────────────────────────────────────────────────

/**
 * Returns an existing status bar item by id, or creates a new one.
 * Status bar items are reused across multiple file events to avoid duplicates.
 * statusBarItems is a plain object used as a dictionary: { id: item, ... }
 */
function getStatusBarItem(id, statusBarItems) {
  let item = statusBarItems[id];
  if (!item) {
    // StatusBarAlignment.Left = left side of the status bar; priority 0 = no special ordering
    item = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Left, 0);
    statusBarItems[id] = item;
  }
  return item;
}

// ── Action executor ────────────────────────────────────────────────────────────

/**
 * Executes a list of actions for a file event.
 *
 * Each element of actionList is a plain object from settings.json, e.g.:
 *   { "autoSave": true }
 *   { "notify": "${relativeFile}", "openLabel": "Open" }
 *   { "showStatusBarItem": "myItem", "text": "Changed!" }
 *
 * Actions are executed in order. Multiple actions can be in one list.
 *
 * @param {vscode.Uri} uri         - URI of the file that triggered the event.
 * @param {Array}      actionList  - Array of action objects from config.
 * @param {Object}     statusBarItems - Shared status bar item cache.
 */
async function actions(uri, actionList, statusBarItems) {
  for (const action of actionList) {

    // ── showStatusBarItem ──────────────────────────────────────────────────────
    // Creates or updates a status bar item at the bottom of the VS Code window.
    // The value of showStatusBarItem is the item's unique ID.
    let showStatusBarItem = getProperty(action, "showStatusBarItem");
    if (showStatusBarItem) {
      let statusBarItem = getStatusBarItem(showStatusBarItem, statusBarItems);
      let backgroundColor = getProperty(action, "backgroundColor");
      if (backgroundColor) { statusBarItem.backgroundColor = new vscode.ThemeColor(backgroundColor); }
      let color = getProperty(action, "color");
      if (color) { statusBarItem.color = new vscode.ThemeColor(color); }
      let name = getProperty(action, "name");
      if (name) { statusBarItem.name = name; }
      let text = getProperty(action, "text");
      if (text) { statusBarItem.text = text; }
      let tooltip = getProperty(action, "tooltip");
      if (tooltip) { statusBarItem.tooltip = tooltip; }
      statusBarItem.show();
    }

    // ── removeStatusBarItem ───────────────────────────────────────────────────
    // Hides and permanently destroys a status bar item by ID.
    let removeStatusBarItem = getProperty(action, "removeStatusBarItem");
    if (removeStatusBarItem) {
      let statusBarItem = getStatusBarItem(removeStatusBarItem, statusBarItems);
      statusBarItem.hide();
      statusBarItem.dispose();           // Frees the VS Code resource
      delete statusBarItems[removeStatusBarItem];  // Remove from cache
    }

    // ── notify ────────────────────────────────────────────────────────────────
    // Shows a popup notification in the bottom-right corner of VS Code.
    // The notification text supports ${variable} substitution (e.g. ${relativeFile}).
    // An "Open" button is shown; clicking it opens the changed file in the editor.
    let notify = getProperty(action, "notify");
    if (notify) {
      let args = {};
      // Resolve ${...} variables in the notification text
      const message = await variableSubstitution(notify, args, uri);
      const openLabel = getProperty(action, "openLabel") || "Open";
      // showInformationMessage returns the label of the button the user clicked,
      // or undefined if the notification was dismissed.
      const selected = await vscode.window.showInformationMessage(message, openLabel);
      if (selected === openLabel) {
        // User clicked "Open" → open the file in the editor
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
      }
    }

    // ── autoSave ──────────────────────────────────────────────────────────────
    // Saves the changed file through VS Code so it gets recorded in Local History.
    // Without this, files modified by external programs (Far Manager, Obsidian, etc.)
    // would not appear in the Local History timeline.
    let autoSave = getProperty(action, "autoSave");
    if (autoSave) {
      try {
        // openTextDocument loads the file (picks up the external changes)
        const doc = await vscode.workspace.openTextDocument(uri);
        // doc.save() triggers VS Code's save pipeline, including Local History
        await doc.save();
      } catch (e) {
        vscode.window.showErrorMessage(`notify-on-file autoSave error: ${e.message}`);
      }
    }
  }
}

// ── Global state ───────────────────────────────────────────────────────────────

// Cache of active status bar items, keyed by their ID string.
let statusBarItems = {};

// List of active watchers. Each entry: { watcher: FileSystemWatcher, events: Disposable[] }
// Stored so we can dispose them all when the configuration changes.
let watchers = [];

// Set of file system paths recently saved by VS Code itself.
// Used to distinguish VS Code saves from external program saves.
//
// How it works:
//   1. onDidSaveTextDocument fires (VS Code save) → path is added here
//   2. FileSystemWatcher.onChange fires shortly after → we check if path is in this Set
//      - YES → saved by VS Code
//      - NO  → saved by external program (Far Manager, Obsidian, etc.)
//   3. After 500ms the path is removed (cleanup – it's no longer needed)
//
// The 500ms window is a safety margin: the onChange event always arrives
// well within that time after onDidSaveTextDocument.
let recentlySavedByVSCode = new Set();

// ── Watcher lifecycle ──────────────────────────────────────────────────────────

/**
 * Stops and destroys all active file system watchers.
 * Called before re-reading the configuration to avoid duplicate watchers.
 */
function disposeWatchers() {
  for (const w of watchers) {
    for (const ev of w.events) { ev.dispose(); }  // Unsubscribe event listeners
    w.watcher.dispose();                            // Stop the file system watcher
  }
  watchers = [];
}

/**
 * Creates a single file system watcher from a config object.
 *
 * watcherConfig corresponds to one entry in settings.json, e.g.:
 *   {
 *     "path": "${workspaceFolder}",
 *     "globPattern": "**\/*",
 *     "onChange": [ { "autoSave": true }, { "notify": "${relativeFile}" } ]
 *   }
 *
 * If "path" is given, the glob is relative to that path (RelativePattern).
 * If "path" is omitted, the glob is workspace-relative (default VS Code behavior).
 *
 * Event types: onChange, onCreate, onDelete.
 * Any omitted event type is ignored (ignoreXxxEvents = true).
 */
async function createWatcher(watcherConfig) {
  let toWatch = getProperty(watcherConfig, "globPattern", "*.js");
  let watchPath = getProperty(watcherConfig, "path");
  if (watchPath) {
    // Resolve ${...} variables in the path string (e.g. ${workspaceFolder})
    watchPath = await variableSubstitution(watchPath);
    // RelativePattern scopes the glob to a specific directory
    toWatch = new vscode.RelativePattern(vscode.Uri.file(watchPath), toWatch);
  }

  let onCreate = getProperty(watcherConfig, "onCreate");
  let onChange = getProperty(watcherConfig, "onChange");
  let onDelete = getProperty(watcherConfig, "onDelete");

  // Tell VS Code to ignore event types we have no actions for (performance optimization)
  let ignoreCreateEvents = onCreate === undefined;
  let ignoreChangeEvents = onChange === undefined;
  let ignoreDeleteEvents = onDelete === undefined;

  const watcher = vscode.workspace.createFileSystemWatcher(
    toWatch, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents
  );

  // Subscribe to the relevant events and store the Disposables so we can clean up later
  // triggerOnVSCodeSave: if false, onChange actions are skipped when VS Code saved the file.
  // triggerOnExternalSave: if false, onChange actions are skipped when an external program saved the file.
  // Both default to true (react to all saves) when not specified.
  const triggerOnVSCodeSave    = dblQuest(getProperty(watcherConfig, "triggerOnVSCodeSave"),    true);
  const triggerOnExternalSave  = dblQuest(getProperty(watcherConfig, "triggerOnExternalSave"),  true);

  const events = [];
  if (onChange) {
    events.push(watcher.onDidChange(uri => {
      const savedByVSCode = recentlySavedByVSCode.has(uri.fsPath);
      // Skip if the save source doesn't match the watcher's filter settings
      if (savedByVSCode  && !triggerOnVSCodeSave)   { return; }
      if (!savedByVSCode && !triggerOnExternalSave)  { return; }
      actions(uri, onChange, statusBarItems);
    }));
  }
  if (onCreate) { events.push(watcher.onDidCreate(uri => { actions(uri, onCreate, statusBarItems); })); }
  if (onDelete) { events.push(watcher.onDidDelete(uri => { actions(uri, onDelete, statusBarItems); })); }

  watchers.push({ watcher, events });
}

/**
 * Reads the current configuration and (re)creates all file watchers.
 * Called on startup and whenever settings.json changes.
 *
 * Supports two config formats:
 *
 * New format (array, multiple watchers):
 *   "notify-on-file.watchers": [ { ... }, { ... } ]
 *
 * Legacy format (single watcher object, backward compatible with original extension):
 *   "notify-on-file.notify": { ... }
 */
async function updateConfiguration() {
  disposeWatchers();  // Always start fresh
  let configuration = vscode.workspace.getConfiguration(extensionShortName, null);

  // New format: array of watcher configs
  let watcherList = configuration.get('watchers');
  if (isArray(watcherList) && watcherList.length > 0) {
    for (const watcherConfig of watcherList) {
      await createWatcher(watcherConfig);
    }
    return;  // Don't fall through to legacy format
  }

  // Legacy format: single "notify" object (original extension behavior)
  let notify = configuration.get('notify');
  if (notify && isObject(notify)) {
    await createWatcher(notify);
  }
}

// ── Extension entry points ─────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension is loaded.
 * Sets up a listener for configuration changes and runs the initial setup.
 *
 * context.subscriptions: VS Code automatically disposes everything in this array
 * when the extension is deactivated, so we don't need to manually unsubscribe.
 */
function activate(context) {
  vscode.workspace.onDidChangeConfiguration(configevent => {
    // Only react if our own config section changed
    if (configevent.affectsConfiguration(extensionShortName)) { updateConfiguration(); }
  }, null, context.subscriptions);

  // Track files saved by VS Code so onChange can distinguish them from external saves.
  // We add the path immediately when VS Code saves, then remove it after 500ms.
  vscode.workspace.onDidSaveTextDocument(doc => {
    recentlySavedByVSCode.add(doc.uri.fsPath);
    setTimeout(() => { recentlySavedByVSCode.delete(doc.uri.fsPath); }, 500);
  }, null, context.subscriptions);

  updateConfiguration();  // Initial setup on extension load
}

/**
 * Called by VS Code when the extension is unloaded (VS Code closes or extension disabled).
 * Cleans up all file watchers to avoid resource leaks.
 */
function deactivate() {
  disposeWatchers();
}

module.exports = {
  activate,
  deactivate
}
