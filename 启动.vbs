Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Dim projectDir
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
ws.CurrentDirectory = projectDir
ws.Run "cmd /c """ & projectDir & "\node_modules\.bin\electron.cmd"" .", 0, False
