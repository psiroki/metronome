let beatsEnabled = true;

let firstBuffer = true;

const beatGen = {
    mixer: {
        silenceElement: null,
        silenceNode: null,
        sampleRate: 48000,
        numChannels: 1,
        get numSamples() {
            var ctx = drums.context;
            if (isNaN(ctx.baseLatency)) return 1024;
            return Math.max(1 << Math.ceil(Math.log(ctx.baseLatency * 2 * this.sampleRate)/Math.log(2)), 256);
        },
        initialize() {
            this.silenceElement = new Audio();
            this.silenceElement.loop = true;
            this.silenceElement.src = "data:audio/x-wav;base64,UklGRooWAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YWYW"+Array(7648).fill("A").join("");
            this.silenceNode = drums.context.createMediaElementSource(this.silenceElement);
            this.silenceNode.connect(drums.context.destination);
            this.silenceElement.play();
            updateMediaSession();
        },
        generateBuffer(time, buffer) {
            if (firstBuffer) {
                var ctx = drums.context;
                controls.outputLatency.value = [ctx.baseLatency, ctx.outputLatency]
                    .map(e => typeof e !== "number" ? "n.a." : (e*1e3).toFixed(2)+"ms")
                    .join("/");
                controls.outputLatency.parentNode.style.display = "";
                firstBuffer = false;
            }
            if (beatsEnabled) {
                const sampleTime = 1 / this.sampleRate;
                const samples = buffer.getChannelData(0);
                const spb = 60 / config.bpm;
                const masterVol = calc.volume(config.masterVolume);
                const barVol = 2 * calc.volume(config.barVolume) * masterVol;
                const emVol = 2 * calc.volume(config.emVolume) * masterVol;
                const obVol = 2 * calc.volume(config.obVolume || 0) * masterVol || barVol;
                const hasOffbeat = !!config.obVolume;
                const beatMul = config.obVolume ? 2 : 1;
                const beatDiv = 1/beatMul;
                const num = config.numerator;
                const waveGen = calc[config.sound] || calc.beat;
                const tuneMul = Math.pow(2, (config.tune || 0)*(1/36));
                const timeMul = Math.pow(2, config.time || 0);
                const timeDiv = 1/timeMul;
                let barTime = time;
                for (let s = 0; s < samples.length; ++s) {
                    const numTime = barTime / (spb * num) % 1;
                    const beatTime = numTime * num * beatMul % 1;
                    barTime += sampleTime;
                    const em = numTime*num*beatMul|0;
                    const offBeat = hasOffbeat && (em & 1);
                    const emTime = em ? 0.25 : 1;
                    const vol = em ? (offBeat ? obVol : barVol) : emVol;
                    samples[s] = waveGen(
                            beatTime * spb * 440 * beatDiv * timeMul,
                            (offBeat ? 3 : 1) * Math.pow(64, 0.5*(0.125+emTime) * tuneMul * timeDiv)
                        ) * vol;
                }
            }
        }
    }
};

const calc = {
    beat(time, tune) {
        let sample = Math.sin(time * tune) / time * 12;
        if (isNaN(sample)) sample = 1.0;
        return sample * Math.min(time * 0.5, 1.0);
    },
    square(time, tune) {
        const amplitude = Math.max(0, Math.min(1, 64 / time|0));
        if (!amplitude) return 0;
        let sample = ((0.25 * time * tune & 1) - 0.5) * amplitude;
        if (isNaN(sample)) sample = 1.0;
        return sample * (Math.min(time * 0.5, 1.0)&1);
    },
    volume(v) {
        return Math.pow(2, v-1) * v;
    }
};

let controlList = handleClones(["outputLatency", "bpmRange", "bpmField", "barVolumeField", "barVolumeRange", "playPauseButton",
    "bpmList", "prevButton", "nextButton", "numeratorRange", "numeratorField", "tuneRange", "tuneField", "timeField", "timeRange",
    "sound"]);
let controls = controlList.reduce((obj, e) => (obj[e] = document.getElementById(e), obj), {});
let config = {};
let suspended = false;

try {
    config = JSON.parse(localStorage.getItem("drumbox"));
    if (config.bpmList) {
        controls.bpmList.value = config.bpmList;
    } else {
        config.bpmList = controls.bpmList.value;
    }
    if (config.sound) {
        (Array.from(controls.sound.children).find(e => e.value === config.sound) || {}).selected = true;
    } else {
        const opt = controls.sound.children[0];
        opt.selected = true;
        config.sound = opt.value;
    }
} catch (e) {
    config = config || {};
}

function toggleSuspend(expected) {
    if (expected === suspended) return;
    let cl = controls.playPauseButton.classList;
    if (suspended) {
        drums.context.resume();
        beatGen.mixer.silenceElement.play();
        suspended = false;
        cl.remove("playButton");
        cl.add("pauseButton");
    } else {
        drums.context.suspend();
        beatGen.mixer.silenceElement.pause();
        suspended = true;
        cl.add("playButton");
        cl.remove("pauseButton");
    }
    updateMediaSession();
}

function updateMediaSession() {
    if (navigator.mediaSession) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: config.bpm+" BPM metronome",
            artist: "DrumBox",
            artwork: [{src:"drums.jpg"}]
        });
        navigator.mediaSession.playbackState = suspended ? "paused" : "playing";
        navigator.mediaSession.setActionHandler("play", () => toggleSuspend(false));
        navigator.mediaSession.setActionHandler("pause", () => toggleSuspend(true));
        navigator.mediaSession.setActionHandler("seekbackward", () => advanceBpmList(-1));
        navigator.mediaSession.setActionHandler("seekforward", () => advanceBpmList(1));
    }
}

function configUpdated(key) {
    if (key === "bpm") updateMediaSession();
    localStorage.setItem("drumbox", JSON.stringify(config));
}

controls.sound.addEventListener("input", e => {
    config.sound = e.currentTarget.value;
    configUpdated("sound");
});

function comp(a, b, e) {
    if (e < 0) return a < b;
    if (e > 0) return a > b;
    return a == b;
}

function stepIndex(list, current, delta) {
    let index = list.indexOf(current);
    if (index < 0) {
        const len = list.length;
        let ri = -1;
        for (let i = 0; i < len; ++i) {
            // delta = -1 => !(list[i] < current)
            if (!comp(list[i], current, delta)) continue;
            // delta = -1 => rv < list[i]
            if (ri < 0 || comp(list[ri], list[i], delta)) {
                ri = i;
            }
        }
        if (Math.abs(delta) > 1) {
            delta -= delta > 0 ? 1 : -1;
            ri += delta;
        }
        index = ri;
    } else {
        index += delta;
    }
    index %= list.length;
    if (index < 0) index += list.length;
    return index;
}

function advanceBpmList(delta) {
    if (delta === 0) return;
    if (typeof delta !== "number") delta = 1;
    let list = controls.bpmList.value.split(/\D+/).map(e => +e).filter(e => !isNaN(e));
    if (!list.length) return;
    let bpm = config.bpm;
    let index = stepIndex(list, bpm, delta);
    controls.bpmField.value = controls.bpmRange.value = config.bpm = list[index];
    configUpdated("bpm");
}

controls.bpmList.addEventListener("input", e => {
    config.bpmList = e.target.value;
    configUpdated("bpmList");
});

controls.playPauseButton.addEventListener("click", () => toggleSuspend());
controls.nextButton.addEventListener("click", () => advanceBpmList(1));
controls.prevButton.addEventListener("click", () => advanceBpmList(-1));

function bindValues(input, output, formatter) {
	let prefix = output.getAttribute("data-prefix") || "";
	if(!formatter)
		formatter = value => value;
	let sync = () => {
		output.value = prefix+formatter(input.value);
	};
	input.addEventListener("input", sync);
	sync();
}

function bindValuesTight(a, b, cb) {
	let f = cb ? value => (cb(value), value) : null;
	bindValues(a, b, f);
	bindValues(b, a, f);
}

const rangeSuffix = "Range";
Object.keys(controls).forEach(key => {
	if (key.substring(key.length - rangeSuffix.length) === rangeSuffix) {
		const base = key.substring(0, key.length - rangeSuffix.length);
		const fieldName = base + "Field";
		if (fieldName in controls) {
		    console.log("Binding "+key+" with "+fieldName);
			if (base in config) {
				[key, fieldName].forEach(n => controls[n].value = config[base]);
			} else {
				config[base] = +controls[fieldName].value;
			}
			bindValuesTight(controls[fieldName], controls[key], newValue => {
				config[base] = +newValue;
				configUpdated(base);
			});
		}
	}
});

function handleClones(controlList) {
    Array.from(document.querySelectorAll("[data-cloneFor]")).forEach(e => {
        let cf = e.getAttribute("data-cloneFor").split(",").map(e => e.trim());
        let replacements = e.getAttribute("data-replace").split("/");
        let values = e.getAttribute("data-values").split(",");
        let search = new RegExp(replacements.shift());
        let before = e.nextSibling;
        let p = e.parentNode;
        let ids = Array.from(e.querySelectorAll("[id]"))
            .map(f => f.id)
            .filter(f => /(?:Range|Field)$/.test(f));
        ids.forEach(f => controlList.push(f));
        let srcId = ids[0].replace(/(?:Range|Field)$/, "");
        cf.forEach((name, i) => {
            const replacement = replacements[i];
            const value = values[i];
            let f = e.cloneNode(true);
            f.removeAttribute("data-cloneFor");
            f.removeAttribute("data-replace");
            var visit = el => {
                if (el.nodeType === Node.TEXT_NODE) {
                    el.nodeValue = el.nodeValue.replace(search, replacement);
                } else if (el.nodeType === Node.ELEMENT_NODE) {
                    for (var n = el.firstChild; n; n = n.nextSibling) visit(n);
                    if (el.id.substring(0, srcId.length) === srcId) {
                        el.id = name + el.id.substring(srcId.length);
                        controlList.push(el.id);
                    }
                    if (el.value === srcId) {
                        el.value = name;
                    } else if ("value" in el) {
                        el.value = value;
                    }
                }
            };
            visit(f);
            p.insertBefore(f, before);
        });
    });
    return controlList;
}
