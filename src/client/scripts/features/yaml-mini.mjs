// Tiny YAML parser wrapper. gray-matter pulls js-yaml in transitively,
// so we reuse it rather than adding another dep.
import yaml from 'js-yaml';

export function parse(text) {
  return yaml.load(text);
}
