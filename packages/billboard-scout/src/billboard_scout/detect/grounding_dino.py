"""Zero-shot detection with Grounding DINO (IDEA Research, Apache-2.0).

"Zero-shot" means no training is needed: we describe what to find in words.
Install with `pip install billboard-scout[detect]`; the model downloads on first use
(tiny ≈ 0.7 GB). Runs on CPU (a few seconds per view) or much faster on a GPU.
For production, fine-tune a small detector on boxes you have reviewed.
"""

from __future__ import annotations

from ..models import View
from .base import Box

DEFAULT_PROMPT = "billboard. advertising poster. advertising panel. digital advertising screen."


class GroundingDinoDetector:
    def __init__(self, model_id: str = "IDEA-Research/grounding-dino-tiny", prompt: str = DEFAULT_PROMPT,
                 box_threshold: float = 0.35, text_threshold: float = 0.25, device: str | None = None,
                 min_box_px: int = 24, max_box_frac: float = 0.9):
        import torch
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id).to(self.device).eval()
        self.prompt = prompt.lower()
        self.box_threshold, self.text_threshold = box_threshold, text_threshold
        self.min_box_px, self.max_box_frac = min_box_px, max_box_frac

    def detect(self, image, view: View) -> list[Box]:
        inputs = self.processor(images=image, text=self.prompt, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            outputs = self.model(**inputs)
        kwargs = dict(text_threshold=self.text_threshold, target_sizes=[image.size[::-1]])
        try:  # argument was renamed in recent transformers versions
            res = self.processor.post_process_grounded_object_detection(outputs, inputs.input_ids, threshold=self.box_threshold, **kwargs)[0]
        except TypeError:
            res = self.processor.post_process_grounded_object_detection(outputs, inputs.input_ids, box_threshold=self.box_threshold, **kwargs)[0]
        labels = res.get("text_labels", res.get("labels"))
        W, H = image.size
        boxes = []
        for (x0, y0, x1, y1), score, label in zip(res["boxes"].tolist(), res["scores"].tolist(), labels):
            w, h = x1 - x0, y1 - y0
            if min(w, h) < self.min_box_px or w * h > self.max_box_frac * W * H:
                continue  # too small to measure, or the whole frame
            boxes.append(Box(x0, y0, x1, y1, float(score), str(label)))
        return boxes
