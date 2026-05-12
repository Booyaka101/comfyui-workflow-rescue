# ComfyUI Workflow Rescue

A tiny browser-based extractor that pulls the embedded ComfyUI workflow + prompt JSON out of MP4 / MOV / WebM / MKV files exported by [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite). Everything runs locally in the browser — files never leave your computer.

**Live:** https://booyaka101.github.io/comfyui-workflow-rescue/

## When this is useful

Drop a video → if there's embedded ComfyUI metadata you get `workflow.json` and `prompt.json` as separate downloads.

The narrow case where this tool actually adds something over ComfyUI's standard drag-drop:

- **Recovering the silently-lost prompt from older VHS exports.** Before [VHS#672](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite/pull/672), `prompt` was double-stringified in the udta atom. ComfyUI's drag-drop still loads the *workflow* fine but silently drops the prompt. This tool reads through the double-encoding and gives you the prompt back. Useful if you want the API-shaped prompt JSON for re-queuing.

## What this doesn't fix

- **Audio-mux strip.** If your video includes audio and was exported before [VHS#653](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite/pull/653), the workflow may have been stripped at write time by an unrelated audio-mux bug. The bytes aren't in the file and no post-hoc tool can recover them. The fix is on the producer side. If you still have the no-audio temp file from the same generation, that one usually loads normally.
- **Reading workflows that ComfyUI already reads fine.** For most files, ComfyUI's standard drag-drop gives you the workflow back. You only need this tool if you specifically want the prompt JSON as a separate file.

## How it works

Vanilla JavaScript, no build step, no framework, no upload. The parsers mirror the ComfyUI frontend's own `isobmff.ts` (for MP4/MOV) and `ebml.ts` (for WebM/MKV) plus a strict unwrap for the legacy double-stringified shape.

## License

MIT. PRs welcome.
