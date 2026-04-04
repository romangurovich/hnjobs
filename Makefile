.PHONY: help dev-tmux api-restart-clean d1-copy-local d1-open-local

help:
	@printf "Available targets:\n"
	@printf "  dev-tmux       Start local dev services in tmux\n"
	@printf "  api-restart-clean  Clear Wrangler temp files and start API dev server\n"
	@printf "  d1-copy-local  Copy local D1 SQLite DB for DataGrip\n"
	@printf "  d1-open-local  Open the copied local D1 SQLite DB with sqlite3\n"

dev-tmux:
	./scripts/dev-tmux.sh

api-restart-clean:
	rm -rf ./packages/api/.wrangler/tmp
	cd ./packages/api && bun run dev

d1-copy-local:
	./scripts/copy-local-d1.sh

d1-open-local:
	sqlite3 ./.local/d1-datagrip/hnjobs-local.sqlite
