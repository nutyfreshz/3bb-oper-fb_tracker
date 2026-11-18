import json
import unicodedata
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parents[1]
BUCKETS = 8192
sources = json.loads((ROOT / "scripts/topic-examples.json").read_text())
labels = list(sources)
rows = [(index, text) for index, topic in enumerate(labels) for text in sources[topic]]

def features(text):
    # Match worker/topic-model.js. Keep Unicode letters, marks and numbers.
    chars = [ord(c) for c in unicodedata.normalize("NFKC", text).lower()
             if unicodedata.category(c)[0] in ("L", "M", "N")][:1200]
    buckets = {}
    for start in range(len(chars)):
        value = 2166136261
        for index in range(start, min(start + 5, len(chars))):
            value = ((value ^ chars[index]) * 16777619) & 0xffffffff
            if index > start:
                slot = value & (BUCKETS - 1)
                buckets[slot] = 1 if (value & 0x80000000) else -1
    scale = max(len(buckets), 1)**-0.5
    return {slot: sign * scale for slot, sign in buckets.items()}

samples = [features(text) for _, text in rows]
indptr = [0]
indices, values = [], []
for sample in samples:
    indices.extend(sample)
    values.extend(sample.values())
    indptr.append(len(indices))
matrix = csr_matrix((values, indices, indptr), shape=(len(rows), BUCKETS))
model = LogisticRegression(C=12, max_iter=1000).fit(matrix, [label for label, _ in rows])
weights = [[int(round(x * 1024)) for x in row] for row in model.coef_]
sparse = [{str(i): value for i, value in enumerate(row) if value} for row in weights]
artifact = {"labels": labels, "weights": sparse, "bias": model.intercept_.tolist()}
(ROOT / "worker/topic-weights.json").write_text(json.dumps(artifact, separators=(",", ":"))+"\n")
print(f"Trained {len(rows)} synthetic examples, {len(labels)} topics.")
