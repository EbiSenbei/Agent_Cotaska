"""Portable asset paths; external tools are selected explicitly by environment."""
from pathlib import Path
import os
import shutil

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / '40_素材'
BUILD = Path(os.environ.get('COTASKA_VIDEO_BUILD', ROOT / '30_編集コード/build')).resolve()
FF = os.environ.get('FFMPEG_BIN') or shutil.which('ffmpeg')
if not FF or not Path(FF).is_file():
    raise RuntimeError('FFmpeg was not found. Set FFMPEG_BIN to the FFmpeg executable.')
FONT_DIR = Path(os.environ.get('COTASKA_FONT_DIR', 'C:/Windows/Fonts'))
for name in ['YuGothB.ttc', 'YuGothM.ttc']:
    if not (FONT_DIR / name).is_file():
        raise RuntimeError(f'Required font is missing: {FONT_DIR / name}')
if BUILD == ROOT or ROOT in BUILD.parents and not (ROOT / '30_編集コード') in BUILD.parents:
    raise RuntimeError('Choose a build directory outside the managed assets or under 30_編集コード.')
BUILD.mkdir(parents=True, exist_ok=True)
