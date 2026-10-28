"""Rebuild narration, music/effects and an AAC master from the retained raw voices."""
import argparse
import json
from pathlib import Path
import subprocess
import wave
import numpy as np
from config import BUILD, MEDIA, FF


def read(path):
    with wave.open(str(path)) as stream:
        if stream.getframerate() != 48000 or stream.getsampwidth() != 2:
            raise ValueError(f'Expected 48 kHz 16-bit PCM: {path}')
        return np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(float).reshape(-1, stream.getnchannels()) / 32768


def save(path, data):
    if np.max(np.abs(data)) >= 1:
        raise ValueError('Master exceeds full scale; lower the mix before exporting.')
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(data.shape[1])
        stream.setsampwidth(2)
        stream.setframerate(48000)
        stream.writeframes((data * 32767).astype('<i2').tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--voices', type=Path, default=MEDIA / 'audio')
    args = parser.parse_args()
    out = BUILD / 'audio'
    out.mkdir()  # Refuse to overwrite a previous mix.
    manifest = json.loads((args.voices / 'manifest.json').read_text(encoding='utf-8'))
    voice = np.zeros((48000 * 60, 1), float)
    scene_ends = [7, 13, 20, 30, 39, 49, 54, 60]
    for item, end in zip(manifest['scenes'], scene_ends):
        number = item['scene']
        adjusted = out / f'normalized-{number:02d}.wav'
        subprocess.run([FF, '-v', 'error', '-n', '-i', str(args.voices / f'voice-{number:02d}.wav'),
                        '-af', 'highpass=f=65,loudnorm=I=-18:TP=-2:LRA=7', '-ar', '48000',
                        '-ac', '1', '-c:a', 'pcm_s16le', str(adjusted)], check=True)
        data = read(adjusted)
        offset = round(item['start'] * 48000)
        if offset + len(data) > round((end - .08) * 48000):
            raise ValueError(f'Scene {number}: speech exceeds its scene. Adjust speech or timing; do not truncate.')
        voice[offset:offset + len(data)] += data
    bed = read(MEDIA / 'audio/original-bgm.wav')
    for when, notes in [(18.3, [72, 76]), (33.3, [72, 79]), (36.4, [76, 79]), (45.4, [72, 76])]:
        for index, note_number in enumerate(notes):
            local = np.arange(round(.32 * 48000)) / 48000
            frequency = 440 * 2 ** ((note_number - 69) / 12)
            note = np.sin(2 * np.pi * frequency * local) * np.exp(-local * 15) * (1 - np.exp(-local * 100)) * .025
            offset = round((when + index * .09) * 48000)
            bed[offset:offset + len(note)] += note[:, None]
    save(out / 'narration.wav', voice)
    save(out / 'music-and-effects.wav', bed)
    save(out / 'mix.wav', voice + bed)
    subprocess.run([FF, '-v', 'error', '-n', '-i', str(out / 'mix.wav'), '-af',
                    'loudnorm=I=-16:TP=-1.5:LRA=7', '-ar', '48000', '-c:a', 'aac',
                    '-b:a', '192k', '-t', '60', str(out / 'master.m4a')], check=True)
    print(out / 'master.m4a')


if __name__ == '__main__':
    main()
