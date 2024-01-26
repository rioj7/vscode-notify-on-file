# Notify On File

You can show a status bar item and/or an Information Notification when a file is created, changed or deleted.

The extension use the  [`vscode.FileSystemWatcher`](https://code.visualstudio.com/api/references/vscode-api#workspace.createFileSystemWatcher). Here you can find more information on the used configuration properties.

The current version only supports 1 file watcher.

## Configuration

The extension has the following settings:

* `notify-on-file.notify` : An object with the following properties:
  * `path` : (Optional) directory where you want to eatch for file changes. Can contain [variables](#variables). If undefined the `globPattern` will be watched for in all open workspaces. (default: undefined)
  * `globPattern` : A [glob pattern](https://code.visualstudio.com/api/references/vscode-api#GlobPattern) that controls for which files the watcher should report events. (default: `*.js`)
  * `onCreate` : An array with [action objects](#action-objects) for a create event.
  * `onChange` : An array with [action objects](#action-objects) for a change event.
  * `onDelete` : An array with [action objects](#action-objects) for a delete event.

## Action Objects

An action object describes what should happen if that event is triggered.

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
  * `notify` : (string) the text to shown in the Information Notification. Can contain [variables](#variables). The file variables use the URI of the file that has the event triggered.

### Example

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
      { "removeStatusBarItem": "build" }
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
