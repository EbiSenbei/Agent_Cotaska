"""Check managed assets and compare a rebuild with the approved v3 streams."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from config import ROOT, BUILD, FF

NAME = 'Cotaska_紹介動画_モーショングラフィックス_v3_NemoB_60秒.mp4'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def ffmpeg(*arguments):
    return subprocess.run([FF, '-v', 'error', *map(str, arguments)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def frames(path):
    data = ffmpeg('-i', path, '-map', '0:v:0', '-f', 'framemd5', '-').decode('ascii')
    return [line for line in data.splitlines() if line and not line.startswith('#')]


def audio(path):
    return hashlib.sha256(ffmpeg('-i', path, '-map', '0:a:0', '-c', 'copy', '-f', 'adts', '-')).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, default=BUILD / NAME)
    args = parser.parse_args()
    reference = ROOT / '10_完成版/v3' / NAME
    inventory = json.loads((ROOT / '20_台本/移管元一覧.json').read_text(encoding='utf-8'))['copied_files']
    for item in inventory:
        if sha(ROOT / item['path']) != item['sha256']:
            raise ValueError(f'Copied asset changed: {item["path"]}')
    ffmpeg('-xerror', '-i', args.video, '-f', 'null', '-')
    original_frames, rebuilt_frames = frames(reference), frames(args.video)
    if len(rebuilt_frames) != 1800 or original_frames != rebuilt_frames:
        raise ValueError('Decoded video frames differ from approved v3.')
    original_audio, rebuilt_audio = audio(reference), audio(args.video)
    master_audio = audio(ROOT / '40_素材/audio/approved-master.m4a')
    if original_audio != rebuilt_audio or original_audio != master_audio:
        raise ValueError('Approved AAC packets changed.')
    original_pcm = hashlib.sha256(ffmpeg('-i', reference, '-map', '0:a:0', '-f', 's16le', '-')).hexdigest()
    rebuilt_pcm = hashlib.sha256(ffmpeg('-i', args.video, '-map', '0:a:0', '-f', 's16le', '-')).hexdigest()
    if original_pcm != rebuilt_pcm:
        raise ValueError('Decoded audio timing or samples changed.')
    report = {'result': 'pass', 'copied_files_verified': len(inventory), 'frames': len(rebuilt_frames),
              'decoded_video_frames_identical': True, 'aac_bitstream_identical': True,
              'decoded_audio_samples_identical': True, 'aac_sha256': rebuilt_audio,
              'approved_mp4_sha256': sha(reference), 'rebuilt_mp4_sha256': sha(args.video),
              'note': '正式フォルダの素材から全編再出力し、採用済みv3と照合。コンテナのメタデータ差は許容。'}
    (BUILD / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
