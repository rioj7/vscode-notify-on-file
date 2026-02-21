# Notify On File

You can show a status bar item and/or an Information Notification when a file is created, changed or deleted.

The extension uses the [`vscode.FileSystemWatcher`](https://code.visualstudio.com/api/references/vscode-api#workspace.createFileSystemWatcher). Here you can find more information on the used configuration properties.

## Configuration

The extension supports two configuration formats:

### New format: multiple watchers (v0.2.0+)

Use `notify-on-file.watchers` to define an array of independent file watchers:

* `notify-on-file.watchers` : An array of watcher objects. Each object has the following properties:
  * `path` : (Optional) directory to watch for file changes. Can contain [variables](#variables). If undefined the `globPattern` will be watched in all open workspaces. (default: undefined)
  * `globPattern` : A [glob pattern](https://code.visualstudio.com/api/references/vscode-api#GlobPattern) that controls which files the watcher should report events for. (default: `*.js`)
  * `triggerOnVSCodeSave` : (Optional, boolean) if `false`, `onChange` actions are skipped when the file was saved by VS Code itself. (default: `true`)
  * `triggerOnExternalSave` : (Optional, boolean) if `false`, `onChange` actions are skipped when the file was saved by an external program. (default: `true`)
  * `onCreate` : An array with [action objects](#action-objects) for a create event.
  * `onChange` : An array with [action objects](#action-objects) for a change event.
  * `onDelete` : An array with [action objects](#action-objects) for a delete event.

### Legacy format: single watcher (v0.1.0)

The original `notify-on-file.notify` single object configuration is still supported for backward compatibility.

* `notify-on-file.notify` : An object with the same properties as a watcher object above (except `triggerOnVSCodeSave` and `triggerOnExternalSave` which are v0.2.0+).

## Action Objects

An action object describes what should happen when an event is triggered.

The possible action objects are:

* `showStatusBarItem` : create or update a [status bar item](https://code.visualstudio.com/api/references/vscode-api#StatusBarItem) with a given `id`  
  The object has the following properties:
  * `showStatusBarItem` : (string) the value for this property is the `id` of the status bar item.
  * `text` : see [status bar item](https://code.visualstudio.com/api/references/vscode-api#StatusBarItem)
  * `tooltip` : see [status bar item](https://code.visualstudio.com/api/references/vscode-api#StatusBarItem)
  * `color` : see [status bar item](https://code.visualstudio.com/api/references/vscode-api#StatusBarItem)
  * `name` : see [status bar item](https://code.visualstudio.com/api/references/vscode-api#StatusBarItem)
  * `backgroundColor` : see [status bar item](https://code.visualstudio.com/api/references/vscode-api#StatusBarItem)
* `removeStatusBarItem` : remove the [status bar item](https://code.visualstudio.com/api/references/vscode-api#StatusBarItem) with a given `id`  
  The object has the following properties:
  * `removeStatusBarItem` : (string) the value for this property is the `id` of the status bar item.
* `notify` : show an Information Notification  
  The object has the following properties:
  * `notify` : (string) the text to show in the Information Notification. Can contain [variables](#variables). The file variables use the URI of the file that triggered the event.
  * `openLabel` : (Optional, string) label for the button that opens the file in the editor when clicked. (default: `"Open"`)
* `autoSave` : save the changed file through VS Code so it gets recorded in [Local History](https://code.visualstudio.com/updates/v1_66#_local-history)  
  The object has the following properties:
  * `autoSave` : (boolean) set to `true` to enable. Without this, files modified by external programs would not appear in the Local History timeline.

### Example: watch workspace for external changes

React only to external program saves (e.g. Far Manager, Obsidian), save to Local History and show a notification with an "Open" button:
```json
"notify-on-file.watchers": [
  {
    "path": "${workspaceFolder}",
    "globPattern": "**/*",
    "triggerOnVSCodeSave": false,
    "triggerOnExternalSave": true,
    "onChange": [
      { "autoSave": true },
      { "notify": "${relativeFile}", "openLabel": "Open" }
    ]
  }
]
```

### Example: multiple watchers
```json
"notify-on-file.watchers": [
  {
    "path": "${workspaceFolder}",
    "globPattern": "**/*",
    "triggerOnVSCodeSave": false,
    "triggerOnExternalSave": true,
    "onChange": [
      { "autoSave": true },
      { "notify": "${relativeFile}", "openLabel": "Open" }
    ]
  },
  {
    "path": "C:/Logs",
    "globPattern": "*.log",
    "onCreate": [
      { "notify": "New log file: ${fileBasename}" }
    ]
  }
]
```

### Example: status bar (legacy format)
```json
"notify-on-file.notify": {
  "path": "${workspaceFolder}",
  "globPattern": ".vscode/build.txt",
  "onCreate": [
    { "showStatusBarItem": "build",
      "backgroundColor": "statusBarItem.warningBackground",
      "text": "$(watch) Building Application",
      "tooltip": "Time to get a drink"
    }
  ],
  "onDelete": [
    { "removeStatusBarItem": "build" },
    { "notify": "Build finished" }
  ]
}
```

## Variables

You can use the following variables in certain strings:

* <code>&dollar;{env:<em>name</em>}</code> : get the value for environment variable <code><em>name</em></code>
* <code>&dollar;{pathSeparator}</code> : the character used by the operating system to separate components in file paths
* <code>&dollar;{userHome}</code> : the path of the user's home folder
* `${workspaceFolder}` : the path of the workspace folder opened in VS Code containing the current file.
* <code>&dollar;{workspaceFolder:<em>name</em>}</code> : the path of the workspace folder with the specified _name_ opened in VS Code
* `${workspaceFolderBasename}` : the name of the workspace folder opened in VS Code containing the current file without any slashes
* `${file}` : the current opened file (the file system path)
* `${relativeFile}` : the current opened file relative to workspaceFolder
* `${relativeFileDirname}` : the current opened file's dirname relative to workspaceFolder
* `${fileBasename}` : the current opened file's basename
* `${fileBasenameNoExtension}` : the current opened file's basename with no file extension
* `${fileExtname}` : the current opened file's extension
* `${fileDirname}` : the current opened file's dirname