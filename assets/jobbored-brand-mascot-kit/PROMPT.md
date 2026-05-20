# Generation Prompt

Mode: built-in `image_gen` using the local `imagegen` skill.

```text
Use case: logo-brand
Asset type: JobBored professional brand mascot logo system sheet, raster concept board
Primary request: Create ONE cohesive brand asset sheet for JobBored, using the attached mascot pose sheet as the exact visual lane. This is not an exploration sheet. It should look like a designer prepared official exports: wordmark, square lockup, vertical lockup, horizontal lockup, light and dark versions.
Input image role: attached image is the style and mascot consistency reference. Match its bean-shaped mint mascot, navy hand-drawn outline, eye shape, antenna, simple job-search props, and warm paper background.
Brand colors: warm paper #FAF7F1, navy #003851, mint #59CB89, amber #EF8F26, small violet #7C3AED only as tiny sparkle if needed. No pure black. No pure white except warm off-white eyes/bubbles.
Wordmark text: write exactly "JobBored". Spell it J-o-b-B-o-r-e-d. "Job" is bold clean navy sans in #003851. "Bored" is mint #59CB89 in soft italic handwritten script. The final d must be clean and normal with no extra tail, flourish, swash, or detached mark.
Sheet layout: premium clean cream board with 8 asset cells, generous whitespace, subtle crop marks only if helpful, no descriptive labels or paragraphs. Cells should show: 1) wordmark only on light, 2) wordmark only on dark navy, 3) horizontal lockup with rocket-pack mascot left of wordmark, 4) horizontal lockup on dark navy, 5) vertical lockup with thoughtful laptop/thought-bubble mascot above wordmark, 6) square icon/avatar with mascot head and thought bubble, 7) square badge-like app icon without enclosing ring, 8) mascot-only rocket pack spot illustration. Keep every mascot as the same character model, only different pose/expression.
Mascot consistency: use the exact same bean body proportions across cells, same eye size and pupils, same antenna curve, same line weight, same mint fill, same hand-drawn navy outline. The rocket-pack and thought-bubble states must look like the same mascot from the attached sheet.
Style: flat vector-like hand-drawn logo illustration, polished but cute, scalable, crisp edges, subtle paper grain. No 3D, no gradients other than very light texture, no photorealism, no isometric, no badges/rings/shields/frames, no extra taglines, no extra words, no watermarks.
Avoid: random new mascot designs, inconsistent body shapes, misspelled wordmark, extra tail on final d, duplicate text artifacts, generic alien/bug look, complex backgrounds, labels, fake UI text.
```

## Local Export Notes

The generated system sheet and pose sheet were copied into this workspace, then cropped and recomposed into named PNG exports with ImageMagick. The original generated files remain under `.codex/generated_images/`.
