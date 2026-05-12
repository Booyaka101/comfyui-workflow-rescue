# ComfyUI Workflow Rescue

A tiny browser-based tool that pulls the embedded ComfyUI workflow JSON out of MP4 / MOV / WebM / MKV files exported by [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite). Everything runs locally in the browser — files never leave your computer.

**Live:** https://booyaka101.github.io/comfyui-workflow-rescue/

## What this is for

If you have a video file produced by VHS and the workflow no longer drag-drops into ComfyUI, the data may still be embedded in the file — just in a shape the ComfyUI frontend can't read directly. Drop the file onto the page and it'll offer the workflow as a `workflow.json` file you can open with ComfyUI's normal *Load* button.

Covers two shapes of legacy bug:

- **Double-stringified prompt** — VHS used to wrap `prompt` twice through `json.dumps`. The frontend's strict JSON parser couldn't decode the result. Producer-side fix is at [VHS#672](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite/pull/672); this tool unwraps the legacy double-encoding so existing files still load.
- **Audio-mux strip** — when VHS adds audio to a video, the mux step re-encapsulates without `-movflags use_metadata_tags`, so custom tags get dropped entirely. Producer-side fix is at [VHS#653](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite/pull/653). If the metadata was already stripped at write time, no recovery is possible — the bytes aren't in the file. If you still have the no-audio temp version from the same generation, try that one.

## How it works

Vanilla JavaScript, no build step, no framework, no upload. The parsers mirror the ComfyUI frontend's own `isobmff.ts` (for MP4/MOV) and `ebml.ts` (for WebM/MKV) plus a strict legacy-string unwrap.

## License

MIT. PRs welcome.
