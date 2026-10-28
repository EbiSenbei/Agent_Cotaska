Add-Type -AssemblyName System.Speech
$cotaskaVoiceOutput = Join-Path $PSScriptRoot 'audio'
New-Item -ItemType Directory -Path $cotaskaVoiceOutput -Force | Out-Null
$cotaskaNarration = @(
    'タスク管理とエーアイチャットを、ひとつの作業画面に。コタスカ。',
    'エーアイに頼むたび、仕事の背景を説明し直していませんか。',
    'やりたいことと、完了条件をタスクに。そのままエーアイへ相談できます。',
    '例えば、サイトの紹介文づくり。子タスクから依頼すれば、タスクの内容を参照して、エーアイが作業を進めます。',
    '返答も、作成したファイルも確認。対応結果をタスクに残し、次の仕事へつなげられます。',
    '日々の仕事は、遅延、今日、完了で見やすく。複数のタスクや子タスクで、作業を整理できます。',
    'タスクは、手元のマークダウンファイルに残ります。',
    'タスク管理とエーアイチャットを、ひとつの作業画面に。コタスカ。'
)
$cotaskaSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$cotaskaSynth.SelectVoice('Microsoft Sayaka')
$cotaskaSynth.Rate = 1
$cotaskaSynth.Volume = 100
for ($cotaskaClipIndex = 0; $cotaskaClipIndex -lt $cotaskaNarration.Count; $cotaskaClipIndex++) {
    $cotaskaWav = Join-Path $cotaskaVoiceOutput ('voice-{0:d2}.wav' -f ($cotaskaClipIndex + 1))
    if (Test-Path -LiteralPath $cotaskaWav) { throw "Voice file exists: $cotaskaWav" }
    $cotaskaSynth.SetOutputToWaveFile($cotaskaWav)
    $cotaskaSynth.Speak($cotaskaNarration[$cotaskaClipIndex])
    $cotaskaSynth.SetOutputToNull()
    Write-Output ('Synthesized {0}/8' -f ($cotaskaClipIndex + 1))
}
$cotaskaSynth.Dispose()
