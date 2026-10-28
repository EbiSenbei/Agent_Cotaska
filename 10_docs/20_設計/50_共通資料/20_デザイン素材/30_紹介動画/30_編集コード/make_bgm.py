"""Recreate the original 88 BPM instrumental bed in the build directory."""
import math
import wave
import numpy as np
from config import BUILD
sr=48000
t=np.arange(sr*60)/sr
music=np.zeros((len(t),2),dtype=np.float64)
chords=[[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]]
def freq(m):return 440*2**((m-69)/12)
beat=60/88
for bar in range(math.ceil(60/(4*beat))):
    notes=chords[bar%len(chords)]
    start=bar*4*beat
    # Soft, slow pad under each bar.
    for ni,n in enumerate(notes):
        nlen=min(4*beat+.6,60-start)
        local=np.arange(round(sr*nlen))/sr
        env=(1-np.exp(-local/0.45))*np.exp(-local/3.5)*np.minimum(1,(nlen-local)/.5)
        pad=np.sin(2*np.pi*freq(n)*local)*env*.006
        at=round(start*sr); end=min(at+len(pad),len(t));pad=pad[:end-at]
        music[at:end,0]+=pad*(.94 if ni%2 else 1)
        music[at:end,1]+=pad*(1 if ni%2 else .94)
    # Sparse felt-key arpeggio, leaving space for speech.
    for step,n in enumerate([notes[0]+12,notes[2]+12,notes[1]+12,notes[3]+12]):
        when=start+step*beat
        if when>=60:continue
        nlen=min(2,60-when);local=np.arange(round(sr*nlen))/sr
        env=(1-np.exp(-local/.012))*np.exp(-local/.42)
        key=(np.sin(2*np.pi*freq(n)*local)+.15*np.sin(2*np.pi*freq(n)*2*local))*env*.018
        at=round(when*sr);end=min(at+len(key),len(t));key=key[:end-at]
        music[at:end,0]+=key*(1 if step%2==0 else .7)
        music[at:end,1]+=key*(.7 if step%2==0 else 1)

music*=np.minimum(1,t[:,None]/1.6)*np.minimum(1,(60-t[:,None])/2)

def save(path,data):
    data=np.clip(data,-.99,.99)
    with wave.open(str(path),'wb') as f:
        f.setnchannels(data.shape[1] if data.ndim==2 else 1);f.setsampwidth(2);f.setframerate(sr)
        f.writeframes((data*32767).astype('<i2').tobytes())

destination=BUILD/'original-bgm.wav'
if destination.exists():raise FileExistsError(destination)
save(destination,music)
print(destination)
