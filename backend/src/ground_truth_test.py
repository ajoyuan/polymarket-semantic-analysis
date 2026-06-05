import argparse
from pathlib import Path

import pandas as pd
import torch
from sklearn.metrics import classification_report, confusion_matrix
from torch.utils.data import DataLoader
from transformers import RobertaForSequenceClassification, RobertaTokenizer

from dataset import MODEL_DIR, RESULTS_DIR, build_label_maps, load_data
from test import BATCH_SIZE, TextClassificationDataset, plot_confusion_matrix, predict

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_GROUND_TRUTH_CSV = BACKEND_DIR / "data" / "polymarket_dataset_test.csv"


def read_ground_truth_csv(path: Path, encoding: str | None = None) -> pd.DataFrame:
    """Read CSV; default tries UTF-8 then common Windows/legacy encodings (Excel often uses cp1252)."""
    if encoding:
        return pd.read_csv(path, encoding=encoding)
    candidates = ("utf-8", "utf-8-sig", "cp1252", "latin-1")
    last_err: UnicodeDecodeError | None = None
    for enc in candidates:
        try:
            df = pd.read_csv(path, encoding=enc)
            if enc != "utf-8":
                print(f"Read CSV using encoding={enc!r} (UTF-8 failed).")
            return df
        except UnicodeDecodeError as e:
            last_err = e
    raise RuntimeError(
        f"Could not decode {path} with any of {candidates}. Last error: {last_err}"
    ) from last_err


def main():
    parser = argparse.ArgumentParser(description="Evaluate model on a ground_truth CSV.")
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_GROUND_TRUTH_CSV,
        help=f"Path to labeled CSV with columns id, question, label (default: {DEFAULT_GROUND_TRUTH_CSV})",
    )
    parser.add_argument(
        "--confusion-out",
        type=Path,
        default=None,
        help="Where to save confusion matrix PNG (default: results/confusion_matrix_ground_truth.png)",
    )
    parser.add_argument(
        "--encoding",
        type=str,
        default=None,
        help="File encoding for the CSV (default: try utf-8, utf-8-sig, cp1252, latin-1)",
    )
    args = parser.parse_args()

    if not MODEL_DIR.exists():
        raise FileNotFoundError(f"No trained model at {MODEL_DIR}. Run train.py first.")
    if not args.csv.exists():
        raise FileNotFoundError(f"Holdout CSV not found: {args.csv}")

    full_df = load_data()
    label2id, id2label = build_label_maps(full_df["label"].tolist())
    class_names = [id2label[i] for i in range(len(id2label))]

    ground_truth_df = read_ground_truth_csv(args.csv, encoding=args.encoding)
    required = {"question", "label"}
    missing = required - set(ground_truth_df.columns)
    if missing:
        raise ValueError(f"CSV missing columns {missing}; have {list(ground_truth_df.columns)}")

    unknown = set(ground_truth_df["label"].unique()) - set(label2id.keys())
    if unknown:
        raise ValueError(
            f"Holdout has labels not seen in training data: {sorted(unknown)}. "
            f"Training labels: {sorted(label2id.keys())}"
        )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")
    print(f"Holdout file: {args.csv}")
    print(f"Samples: {len(ground_truth_df)}")
    print("Label counts:\n", ground_truth_df["label"].value_counts().sort_index())

    tokenizer = RobertaTokenizer.from_pretrained(MODEL_DIR)
    model = RobertaForSequenceClassification.from_pretrained(MODEL_DIR).to(device)

    ground_truth_labels = ground_truth_df["label"].map(label2id).tolist()
    ds = TextClassificationDataset(ground_truth_df["question"].tolist(), ground_truth_labels, tokenizer)
    loader = DataLoader(ds, batch_size=BATCH_SIZE, shuffle=False)

    preds, labels = predict(model, loader, device)
    accuracy = (preds == labels).mean()
    print(f"\nAccuracy: {accuracy:.4f}")

    cm = confusion_matrix(labels, preds)
    print("\nConfusion matrix:")
    print(cm)
    print("\nClassification report:")
    print(classification_report(labels, preds, target_names=class_names, digits=4))

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = args.confusion_out or (RESULTS_DIR / "confusion_matrix_ground_truth.png")
    plot_confusion_matrix(cm, class_names, out_path)


if __name__ == "__main__":
    main()
