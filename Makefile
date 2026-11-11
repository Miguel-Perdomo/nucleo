PORT ?= 8000
PY   ?= python3

.PHONY: build serve clean

build:            ## Regenera docs/data/*.json desde data_pipeline/raw
	$(PY) data_pipeline/build_db.py

serve: build      ## Sirve el sitio en http://localhost:$(PORT)
	@echo "→ http://localhost:$(PORT)  (Ctrl+C para detener)"
	$(PY) -m http.server $(PORT) -d docs

clean:
	rm -f docs/data/*.json
