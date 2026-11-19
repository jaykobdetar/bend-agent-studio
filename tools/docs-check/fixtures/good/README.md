# Good fixture
[Guide](docs/guide.md#repeat-1)
![Diagram](docs/picture.svg)
[Named][guide]
[guide]: docs/guide.md#explicit
`scripts/demo.mjs` and `docs/guide.md`.
```sh
node scripts/demo.mjs config.json > generated.json
python3 scripts/demo.py config.json generated.json
bend scripts/demo.bend
```
<!-- docs-check: cwd=scripts -->
```bash
node demo.mjs
```
