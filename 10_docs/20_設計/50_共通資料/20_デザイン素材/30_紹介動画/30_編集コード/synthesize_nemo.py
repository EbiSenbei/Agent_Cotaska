"""Regenerate voices through an already running local VOICEVOX Nemo engine."""
import argparse
import io
import json
import urllib.parse
import urllib.request
import wave
from config import BUILD, MEDIA


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine-url', default='http://127.0.0.1:50129')
    parser.add_argument('--manifest', default=MEDIA / 'audio/manifest.json')
    args = parser.parse_args()
    url = args.engine_url.rstrip('/')
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'http' or parsed.hostname not in ['127.0.0.1', 'localhost', '::1']:
        raise ValueError('Use a local Nemo engine URL.')
    version = json.load(urllib.request.urlopen(url + '/version', timeout=10))
    if version != '0.26.0':
        raise ValueError(f'Expected Nemo 0.26.0; received {version}')
    speakers = json.load(urllib.request.urlopen(url + '/speakers', timeout=10))
    if not any(s['name'] == '女声6' and any(t['id'] == 10006 for t in s['styles']) for s in speakers):
        raise ValueError('Nemo 女声6 (style 10006) is unavailable.')
    out = BUILD / 'nemo-input'
    out.mkdir()
    manifest = json.loads(open(args.manifest, encoding='utf-8').read())
    for item in manifest['scenes']:
        number = item['scene']
        query_url = url + '/audio_query?' + urllib.parse.urlencode({'text': item['text'], 'speaker': 10006})
        request = urllib.request.Request(query_url, method='POST')
        query = json.load(urllib.request.urlopen(request, timeout=90))
        query.update(speedScale=item['speedScale'], intonationScale=item['intonationScale'],
                     pitchScale=item['pitchScale'], volumeScale=1.0, prePhonemeLength=.12,
                     postPhonemeLength=.16, outputSamplingRate=48000, outputStereo=False)
        request = urllib.request.Request(url + '/synthesis?speaker=10006', data=json.dumps(query).encode('utf-8'),
                                         headers={'Content-Type': 'application/json'}, method='POST')
        data = urllib.request.urlopen(request, timeout=180).read()
        with wave.open(io.BytesIO(data)) as stream:
            item['duration'] = stream.getnframes() / stream.getframerate()
        (out / f'voice-{number:02d}.wav').write_bytes(data)
        (out / f'voice-{number:02d}-query.json').write_text(json.dumps(query, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'Scene {number}/8: {item["duration"]:.3f}s', flush=True)
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(out)


if __name__ == '__main__':
    main()
