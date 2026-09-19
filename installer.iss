[Setup]
AppName=Zenxy Workspace
AppVersion=1.0.0
AppPublisher=Zenxy
AppPublisherURL=https://github.com/zenxy177/zenxy-workspace-app
DefaultDirName={autopf}\Zenxy Workspace
DefaultGroupName=Zenxy Workspace
OutputDir=dist
OutputBaseFilename=Zenxy-Workspace-Setup-v1.0
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\assets\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "assets\icon.ico"; DestDir: "{app}\assets"; Flags: ignoreversion

[Icons]
Name: "{group}\Zenxy Workspace"; Filename: "{app}\Zenxy Workspace.exe"; IconFilename: "{app}\assets\icon.ico"
Name: "{group}\{cm:UninstallProgram,Zenxy Workspace}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Zenxy Workspace"; Filename: "{app}\Zenxy Workspace.exe"; IconFilename: "{app}\assets\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\Zenxy Workspace.exe"; Description: "{cm:LaunchProgram,Zenxy Workspace}"; Flags: nowait postinstall skipifsilent
