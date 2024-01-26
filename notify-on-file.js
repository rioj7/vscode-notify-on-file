const vscode = require('vscode');
const path = require('path');

function getProperty(obj, prop, deflt) { return obj.hasOwnProperty(prop) ? obj[prop] : deflt; }
function isString(obj) { return typeof obj === 'string';}
function isArray(obj) { return Array.isArray(obj);}
function isObject(obj) { return (typeof obj === 'object') && !isArray(obj);}
function dblQuest(value, deflt) { return value !== undefined ? value : deflt; }
function errorMessage(msg, noObject) { vscode.window.showErrorMessage(msg); return noObject ? noObject : "Unknown";}

const extensionShortName = 'notify-on-file';

/** @callback ReplaceCB */
/** @param {string} text @param {string} variableRegex @param {number} capGroupCount @param {string | ReplaceCB} replacement */
function variableReplace(text, variableRegex, capGroupCount, replacement) {
  let varRE = new RegExp(`\\$\\{${variableRegex}\\}`, 'g');
  text = text.replace(varRE, (m, ...ppp) => {
    ppp.splice(capGroupCount); // only retain capture groups - remove arguments: offset, string, groups
    ppp.unshift(m); // replacement funcs want 'm' as first argument
    // let _replacement = isString(replacement) ? replacement : replacement(...ppp);
    // typescript generates some vague errors so we have to rewrite
    return typeof replacement === 'string' ? replacement : replacement.apply(null, ppp);
  });
  return text;
}
function URIWorkspaceFolder(uri, action) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return errorMessage('No folder open'); }
  let wsf = undefined;
  if (folders.length > 1) {
    if (!uri) { return errorMessage('Use the name of the Workspace Folder'); }
    wsf = vscode.workspace.getWorkspaceFolder(uri);
  }
  if (!wsf) {
    wsf = folders[0];  // choose first folder in the list
  }
  return action(wsf);
}
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
};
function variableSubstitutionSync_1(result, uri) {
  result = variableReplace(result, 'pathSeparator', 0, process.platform === 'win32' ? '\\' : '/');
  result = variableReplace(result, 'userHome', 0, m => variableSubstitutionSync_1(process.platform === 'win32' ? '${env:HOMEDRIVE}${env:HOMEPATH}' : '${env:HOME}', uri));
  result = variableReplace(result, 'env:(.+?)', 1, (m, p1) => {
    return getProperty(process.env, p1, '');
  } );
  result = variableReplace(result, 'workspaceFolder', 0, m => {
    return URIWorkspaceFolder(uri, workspaceFolder => {
      return workspaceFolder.uri.fsPath;
    });
  });
  result = variableReplace(result, 'workspaceFolder:(.+?)', 1, (m, p1) => {
    let wsf = getNamedWorkspaceFolder(p1);
    if (!wsf) { return 'Unknown'; }
    return wsf.uri.fsPath;
  });
  result = variableReplace(result, 'workspaceFolderBasename', 0, m => {
    return URIWorkspaceFolder(uri, workspaceFolder => {
      return path.basename(workspaceFolder.uri.fsPath);
    });
  });
  return result;
}
async function variableSubstitution(text, args, uri) {
  args = dblQuest(args, {});
  let stringSubstitution = async (text) => {
    if (!isString(text)) { return text; }
    var result = text;
    result = variableSubstitutionSync_1(result, uri);

    if (result === undefined) { return undefined; }

    if (!uri) { return result; }
    const fileFSPath = uri.fsPath;
    result = variableReplace(result, 'file', 0, fileFSPath);
    const relativeFile = URIWorkspaceFolder(uri, workspaceFolder => {
      const wsfFSPath = workspaceFolder.uri.fsPath;
      if (fileFSPath.startsWith(wsfFSPath)) {
        return fileFSPath.substring(wsfFSPath.length + 1); // remove extra separator;
      }
      return 'Unknown';
    });
    result = variableReplace(result, 'relativeFile', 0, relativeFile);
    const filePath = uri.path;
    const lastSep = filePath.lastIndexOf('/');
    if (lastSep === -1) { return result; }
    const fileBasename = filePath.substring(lastSep+1);
    result = variableReplace(result, 'fileBasename', 0, fileBasename);
    const lastDot = fileBasename.lastIndexOf('.');
    const fileBasenameNoExtension = lastDot >= 0 ? fileBasename.substring(0, lastDot) : fileBasename;
    result = variableReplace(result, 'fileBasenameNoExtension', 0, fileBasenameNoExtension);
    const fileExtname = lastDot >= 0 ? fileBasename.substring(lastDot) : '';
    result = variableReplace(result, 'fileExtname', 0, fileExtname);
    let fileDirname = fileFSPath.substring(0, fileFSPath.length-(fileBasename.length+1));
    result = variableReplace(result, 'fileDirname', 0, fileDirname);
    let relativeFileDirname = relativeFile;
    if (relativeFile.endsWith(fileBasename)) {
      relativeFileDirname = relativeFile.substring(0, relativeFile.length-(fileBasename.length+1));
    }
    result = variableReplace(result, 'relativeFileDirname', 0, relativeFileDirname);
    return result;
  };
  let stringSubstitutionDepthN = async (text) => {
    if (!isString(text)) { return text; }
    while (text.indexOf('${') >= 0) {
      let newText = await stringSubstitution(text);
      if (newText === undefined) { return undefined; }
      if (newText === text) { break; }
      text = newText;
    }
    return text;
  };
  return await stringSubstitutionDepthN(text);
};
function getStatusBarItem(id, statusBarItems) {
  let item = statusBarItems[id];
  if (!item) {
    item = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Left, 0);
    statusBarItems[id] = item;
  }
  return item;
}
async function actions(uri, actionList, statusBarItems) {
  for (const action of actionList) {
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
    let removeStatusBarItem = getProperty(action, "removeStatusBarItem");
    if (removeStatusBarItem) {
      let statusBarItem = getStatusBarItem(removeStatusBarItem, statusBarItems);
      statusBarItem.hide();
      statusBarItem.dispose();
      delete statusBarItems[removeStatusBarItem];
    }
    let notify = getProperty(action, "notify");
    if (notify) {
      let args = {};
      vscode.window.showInformationMessage(await variableSubstitution(notify, args, uri));
    }
  }
}
let statusBarItems = {};
let watcher = undefined;
let watcherEvents = [];
function disposeWatcher() {
  if (!watcher) { return; }
  for (const ev of watcherEvents) { ev.dispose(); }
  watcher.dispose();
  watcher = undefined;
  watcherEvents = [];
}
async function updateConfiguration() {
  disposeWatcher();
  let configuration = vscode.workspace.getConfiguration(extensionShortName, null);
  let notify = configuration.get('notify');
  let toWatch = getProperty(notify, "globPattern", "*.js");
  let path = getProperty(notify, "path");
  if (path) {
    path = await variableSubstitution(path);
    toWatch = new vscode.RelativePattern(vscode.Uri.file(path), toWatch);
  }
  let onCreate = getProperty(notify, "onCreate");
  let onChange = getProperty(notify, "onChange");
  let onDelete = getProperty(notify, "onDelete");

  let ignoreCreateEvents = onCreate === undefined;
  let ignoreChangeEvents = onChange === undefined;
  let ignoreDeleteEvents = onDelete === undefined;

  const watcher = vscode.workspace.createFileSystemWatcher(toWatch, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents);

  watcherEvents.push(watcher.onDidChange(uri => { actions(uri, onChange, statusBarItems); }));
  watcherEvents.push(watcher.onDidCreate(uri => { actions(uri, onCreate, statusBarItems); }));
  watcherEvents.push(watcher.onDidDelete(uri => { actions(uri, onDelete, statusBarItems); }));
}
function activate(context) {
  vscode.workspace.onDidChangeConfiguration( configevent => {
    if (configevent.affectsConfiguration(extensionShortName)) { updateConfiguration(); }
  }, null, context.subscriptions);
  updateConfiguration();
}
function deactivate() {
  disposeWatcher();
}

module.exports = {
  activate,
  deactivate
}
