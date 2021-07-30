const drums = {
    mixer: beatGen.mixer,
    buffers: null,
    bufferTime: 0,
    nextBufferIndex: 0,
    initialize() {
        const context = this.context;
        const mixer = this.mixer;
        mixer.initialize();
        const buffers = this.buffers = [];
        const numBuffers = 2;
        const bufferTime = mixer.numSamples / mixer.sampleRate;
        console.log("Buffer time is", bufferTime, "that is", mixer.numSamples, "samples");
        const dest = context.destination;
        for (let i = 0; i < numBuffers; ++i) {
            let buffer = context.createBuffer(
                mixer.numChannels,
                mixer.numSamples,
                mixer.sampleRate
            );
            let node = context.createBufferSource();
            node.buffer = buffer;
            node.connect(dest);
            buffers.push(node);
        }
        const startNext = (nodes, indexOpt) => {
            const thisTime = drums.bufferTime;
            drums.bufferTime += bufferTime;
            if (typeof indexOpt === "undefined") {
                indexOpt = drums.nextBufferIndex;
                drums.nextBufferIndex = (drums.nextBufferIndex + 1) % numBuffers;
            } else {
                drums.nextBufferIndex = (indexOpt + 1) % numBuffers;
            }
            const index = indexOpt;
            const node = nodes[index];
            mixer.generateBuffer(thisTime, node.buffer);
            node.start(thisTime);
            node.onended = () => startNext(nodes, index);
            const newNode = context.createBufferSource();
            newNode.buffer = node.buffer;
            newNode.connect(dest);
            nodes[index] = newNode;
        };
        for (let i = 0; i < numBuffers; ++i) {
            startNext(buffers);
        }
    }
};

(()=>{
    let context = null;
    Object.defineProperty(drums, "context", {
        get() {
            if (context === null) {
                context = new (window.AudioContext || window.webkitAudioContext)();
            }
            return context;
        }
    });
    
    const listeners = ["mouseup", "focus"];
    const initContext = _ => {
        const context = drums.context;
        console.log(JSON.stringify({
            baseLatency: context.baseLatency,
            outputLatency: context.outputLatency
        }, null, 2));
        drums.initialize();
        document.body.classList.remove("noContext");
        listeners.forEach(l => document.body.removeEventListener(l, initContext));
    };
    listeners.forEach(l => document.body.addEventListener(l, initContext));

})();

(() => {
    const drums = this;
}).call(drums);

document.body.classList.remove("loading");
if (!window.AudioContext && !window.webkitAudioContext) document.body.classList.add("noSupport");