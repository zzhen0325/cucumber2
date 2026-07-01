#!/usr/bin/env python3
"""withoutBG Focus bridge for Cucumber Super Agent.

Uses the Apache-2.0 withoutbg project:
https://github.com/withoutbg/withoutbg
"""

import argparse
import json
import os
import sys


def fail(message: str, code: int = 2) -> None:
    print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
    raise SystemExit(code)


def composite_background(image, background: str):
    if background == "transparent":
        return image
    color = (255, 255, 255, 255) if background == "white" else (242, 242, 239, 255)
    canvas = image.__class__.new("RGBA", image.size, color)
    canvas.alpha_composite(image.convert("RGBA"))
    return canvas.convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run withoutBG background removal.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--background", choices=["transparent", "white", "neutral"], default="transparent")
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    args = parser.parse_args()

    try:
        from PIL import Image
        from withoutbg import WithoutBG
    except ModuleNotFoundError:
        fail(
            "withoutbg is not installed. Install it with: python3 -m pip install withoutbg",
            3,
        )

    try:
        api_key = os.environ.get("WITHOUTBG_API_KEY")
        model = WithoutBG.api(api_key=api_key) if api_key else WithoutBG.opensource()
        result = model.remove_background(args.input)
        result = result.convert("RGBA")
        if args.width and args.height:
            result = result.resize((args.width, args.height), Image.Resampling.LANCZOS)
        output = composite_background(result, args.background)
        output.save(args.output)
    except Exception as exc:
        fail(f"withoutBG matting failed: {exc}", 4)

    print(
        json.dumps(
            {
                "ok": True,
                "background": args.background,
                "engine": "withoutbg",
                "height": output.height,
                "mode": output.mode,
                "provider": "withoutbg-api" if os.environ.get("WITHOUTBG_API_KEY") else "withoutbg-local",
                "width": output.width,
            }
        )
    )


if __name__ == "__main__":
    main()
