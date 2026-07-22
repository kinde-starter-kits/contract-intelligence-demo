"""CLI entrypoint for the contract review crew.

  python -m contract_crew.main --contract-id <id> --acting-subject <kinde user id>
                               [--mode crew|deterministic]

The authorization mode (broken|intersection) is decided by the SERVER
(deployment env AUTHZ_MODE), not by the crew — the run reports which was applied.
"""

from __future__ import annotations

import argparse
import sys

from .runner import run_deterministic, run_with_crew


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Review a contract with the crew.")
    parser.add_argument("--contract-id", required=True, help="Convex contract id.")
    parser.add_argument(
        "--acting-subject",
        required=True,
        help="Kinde user id of the human the crew acts for.",
    )
    parser.add_argument(
        "--mode",
        choices=["crew", "deterministic"],
        default="crew",
        help="crew = LLM agents (needs an LLM key); deterministic = rule-based.",
    )
    parser.add_argument(
        "--llm-api-key",
        default=None,
        help="BYOK: provider key for this run only (not persisted/logged). "
        "Falls back to the provider key in the environment when omitted.",
    )
    parser.add_argument(
        "--llm-model",
        default=None,
        help="Override the LiteLLM model id for this run.",
    )
    args = parser.parse_args(argv)

    if args.mode == "crew":
        summary = run_with_crew(
            args.contract_id,
            args.acting_subject,
            llm_api_key=args.llm_api_key,
            llm_model=args.llm_model,
        )
    else:
        summary = run_deterministic(args.contract_id, args.acting_subject)
    print(summary.describe())
    return 0


if __name__ == "__main__":
    sys.exit(main())
