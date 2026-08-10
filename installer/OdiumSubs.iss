; Odium Subs - kurulum betigi (Inno Setup 6/7)
;
; Derleme:
;   "C:\Program Files\Inno Setup 7\ISCC.exe" installer\OdiumSubs.iss
; Cikti:
;   dist\OdiumSubsSetup.exe
;
; Yonetici GEREKMEZ: her sey kullanici profiline yaziliyor.
;   - uzanti  -> %APPDATA%\Adobe\CEP\extensions\OdiumSubs
;   - CEP debug modu -> HKCU\Software\Adobe\CSXS.9..14  (imzasiz uzanti izni)
;
; Whisper (1.4 GB) ve modeller kurulum PAKETINE GIRMEZ; panel ilk
; transkripsiyonda kendisi indirir. ffmpeg de whisper paketinin icinde geliyor.

#define AppName "Odium Subs"
#define AppVersion "1.0.0"
#define AppPublisher "Odium Studio"
#define ExtensionId "OdiumSubs"

[Setup]
AppId={{9C2F1B7E-4A3D-4C55-9E71-0D6B2A5F8C10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={userappdata}\Adobe\CEP\extensions\{#ExtensionId}
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=OdiumSubsSetup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
SetupLogging=yes

[Languages]
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"

[Messages]
tr.WelcomeLabel2=[name/ver] bilgisayariniza kurulacak.%n%nPremiere Pro'yu kurulumdan once kapatin.%n%nWhisper (yaklasik 1,4 GB) ve dil modelleri kuruluma dahil degildir; panel ilk kullanimda kendisi indirir.

[Files]
Source: "..\CSXS\*";     DestDir: "{app}\CSXS";     Flags: ignoreversion recursesubdirs
Source: "..\client\*";   DestDir: "{app}\client";   Flags: ignoreversion recursesubdirs
Source: "..\jsx\*";      DestDir: "{app}\jsx";      Flags: ignoreversion recursesubdirs
Source: "..\engine\*";   DestDir: "{app}\engine";   Flags: ignoreversion recursesubdirs; Excludes: "test\*"
Source: "..\templates\*"; DestDir: "{app}\templates"; Flags: ignoreversion recursesubdirs skipifsourcedoesntexist
Source: "..\docs\*";     DestDir: "{app}\docs";     Flags: ignoreversion recursesubdirs skipifsourcedoesntexist
Source: "..\README.md";  DestDir: "{app}";          Flags: ignoreversion
Source: "..\version.json"; DestDir: "{app}";        Flags: ignoreversion skipifsourcedoesntexist

[Registry]
; Imzasiz uzantinin yuklenebilmesi icin. Deger STRING olmali (DWORD degil).
;
; uninsdeletevalue KULLANMA. Bu ayar makine genelinde: kaldirma sirasinda
; silinirse ayni makinedeki diger imzasiz CEP panelleri de acilmaz olur.
; Gercekten yasandi - kaldirma testi sonrasi panel bos acildi, CEP motoru
; hic baslamadi ve sebebi bulmak uzun surdu.
Root: HKCU; Subkey: "Software\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.13"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist
Root: HKCU; Subkey: "Software\Adobe\CSXS.14"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: createvalueifdoesntexist

[UninstallDelete]
; Panelin urettigi ara dosyalar (ses, whisper json, srt, loglar)
Type: filesandordirs; Name: "{app}\.probe"
; Indirilen whisper - kaldirirken 1,4 GB'i birakmayalim
Type: filesandordirs; Name: "{app}\tools"

[Code]
function GetFileAttributesW(lpFileName: string): DWORD;
  external 'GetFileAttributesW@kernel32.dll stdcall';

{
  Gelistirme kurulumu (tools\Dev-Link.bat) hedef klasore bir junction aciyor.
  Uzerine kurulum yapilirsa dosyalar junction uzerinden DEPOYA yazilir.
  Junction'i once kaldiriyoruz - RemoveDir baglantiyi siler, hedefe dokunmaz.
}
procedure RemoveJunctionIfPresent();
var
  Attr: DWORD;
  Target: string;
begin
  Target := ExpandConstant('{app}');
  if not DirExists(Target) then
    Exit;

  Attr := GetFileAttributesW(Target);
  if (Attr <> $FFFFFFFF) and ((Attr and FILE_ATTRIBUTE_REPARSE_POINT) <> 0) then
  begin
    Log('Hedef bir junction, kaldiriliyor: ' + Target);
    if not RemoveDir(Target) then
      MsgBox('Hedef klasor bir baglanti (junction) ve kaldirilamadi:' + #13#10 +
             Target + #13#10 + #13#10 +
             'Elle silip kurulumu tekrar calistirin.', mbError, MB_OK);
  end;
end;

function PremiereRunning(): Boolean;
var
  ResultCode: Integer;
begin
  { tasklist ciktisinda Premiere varsa FIND 0 doner }
  Result := Exec(ExpandConstant('{cmd}'),
    '/C tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" | find /I "Adobe Premiere Pro.exe" > nul',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if PremiereRunning() then
  begin
    if MsgBox('Adobe Premiere Pro calisiyor.' + #13#10 + #13#10 +
              'Kurulumun duzgun tamamlanmasi icin once Premiere''i tamamen kapatin.' + #13#10 + #13#10 +
              'Yine de devam edilsin mi?', mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    RemoveJunctionIfPresent();

  if CurStep = ssPostInstall then
  begin
    MsgBox('Kurulum tamamlandi.' + #13#10 + #13#10 +
           'Premiere Pro''yu acin:' + #13#10 +
           'Window > Extensions > Odium Subs' + #13#10 + #13#10 +
           'Ilk transkripsiyonda Whisper (~1,4 GB) ve dil modeli (~1,6 GB) inecek. ' +
           'Bu tek seferliktir.', mbInformation, MB_OK);
  end;
end;
