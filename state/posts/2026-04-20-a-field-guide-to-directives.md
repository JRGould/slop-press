---
title: A Field Guide to SlopPress Directives
slug: 2026-04-20-a-field-guide-to-directives
date: 2026-04-20
---

Directives are the little embedded instructions SlopPress resolves on the fly. Drop one into any post body and the server fills it in as it renders.

[image: a vintage naturalist field-guide illustration of a whimsical bird labeled "directive bird", ink and watercolor on aged cream paper]

## [imagine: …]

The `[imagine: …]` directive asks the model to invent fresh text that fits the surrounding copy. Great for filler that should feel alive without pinning down exact wording.

[imagine: a three-sentence description of what the "directive bird" eats, told in the voice of an overly enthusiastic Victorian naturalist]

## [continue]

Use `[continue]` when the paragraph you already wrote is the shape — you just want the model to keep pulling on that thread. The tone carries over automatically.

The rain had been falling for three days when the library opened its doors to the public for the first time that spring. [continue]

## [image: …]

`[image: …]` generates a picture and inlines it at that spot. The prompt should be a short visual description. Cache keys are derived from the post so the same image reappears on later loads.

[image: a cozy overhead flatlay of a writer's desk — typewriter, mug of tea, loose ink-smudged manuscript pages, warm afternoon light]

## Mix freely

You can combine all three in a single post. The goal is to treat the markdown like a script: write what you know, leave placeholders for what you don't, and let the server finish the scene.
