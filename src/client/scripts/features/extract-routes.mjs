// Walk a routes.ts file and return all concrete route patterns,
// joining nested children with their parent path. Wildcards ('**')
// are excluded; redirects are included.

import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export async function extractRoutes(filePath) {
  const src = await readFile(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);

  const routesArray = findRoutesArray(sourceFile);
  if (!routesArray) {
    throw new Error(`${filePath}: could not find an exported Routes array`);
  }

  const collected = new Set();
  walk(routesArray, '', collected);
  return [...collected].sort();
}

function findRoutesArray(node) {
  let result = null;
  ts.forEachChild(node, (child) => {
    if (result) return;
    if (
      ts.isVariableStatement(child) &&
      child.declarationList.declarations.some(
        (d) =>
          ts.isVariableDeclaration(d) &&
          d.initializer &&
          ts.isArrayLiteralExpression(d.initializer),
      )
    ) {
      const decl = child.declarationList.declarations.find(
        (d) => d.initializer && ts.isArrayLiteralExpression(d.initializer),
      );
      result = decl.initializer;
    }
  });
  return result;
}

function walk(arrayLit, parentPath, out) {
  for (const el of arrayLit.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    let path = null;
    let children = null;
    for (const prop of el.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name && (prop.name.text ?? prop.name.escapedText);
      if (key === 'path' && ts.isStringLiteral(prop.initializer)) {
        path = prop.initializer.text;
      } else if (key === 'children' && ts.isArrayLiteralExpression(prop.initializer)) {
        children = prop.initializer;
      }
    }
    if (path === null) continue;
    const joined = path === '' ? parentPath : parentPath ? `${parentPath}/${path}` : path;
    if (path !== '**' && joined) {
      out.add(joined);
    }
    if (children) {
      walk(children, joined, out);
    }
  }
}
