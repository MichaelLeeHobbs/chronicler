/**
 * AST parser for extracting event definitions from TypeScript files
 */

import path from 'node:path';

import * as ts from 'typescript';

import type { EventDefinition } from '../../core/events';
import type { FieldBuilder } from '../../core/fields';
import type { ParsedEventTree, ValidationError } from '../types';

/**
 * Parse events file and extract all event definitions
 */
export function parseEventsFile(filePath: string): ParsedEventTree {
  const absolutePath = path.resolve(filePath);

  // Create TypeScript program
  const program = ts.createProgram([absolutePath], {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    allowJs: false,
    skipLibCheck: true,
  });

  const sourceFile = program.getSourceFile(absolutePath);
  if (!sourceFile) {
    throw new Error(`Could not load source file: ${absolutePath}`);
  }

  const events: EventDefinition[] = [];
  const errors: ValidationError[] = [];

  // Visit all nodes in the AST
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      try {
        const extracted = extractFromCallExpression(node);
        if (extracted) {
          events.push(extracted);
        }
      } catch (error) {
        let line = 0;
        let character = 0;
        try {
          const pos = sourceFile!.getLineAndCharacterOfPosition(node.getStart());
          line = pos.line;
          character = pos.character;
        } catch {
          // Node may not have valid position info
        }
        errors.push({
          type: 'parse-error',
          message: error instanceof Error ? error.message : 'Unknown parse error',
          location: {
            file: absolutePath,
            line: line + 1,
            column: character + 1,
          },
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    events,
    groups: [], // Groups will be built from events in tree-builder
    errors,
  };
}

/**
 * Extract event definition from a call expression
 */
function extractFromCallExpression(node: ts.CallExpression): EventDefinition | null {
  // Check if it's a defineEvent call
  if (!ts.isIdentifier(node.expression)) {
    return null;
  }

  const functionName = node.expression.text;
  if (functionName !== 'defineEvent') {
    return null;
  }

  // Get the first argument (should be object literal, possibly wrapped in `as const`)
  let arg = node.arguments[0];
  if (arg && ts.isAsExpression(arg)) {
    arg = arg.expression;
  }
  if (!arg || !ts.isObjectLiteralExpression(arg)) {
    throw new Error('defineEvent requires an object literal argument');
  }

  const props = extractObjectProperties(arg);

  // Validate required properties
  if (!props.key || typeof props.key !== 'string') {
    throw new Error('defineEvent requires "key" property');
  }
  if (!props.level || typeof props.level !== 'string') {
    throw new Error('defineEvent requires "level" property');
  }
  if (!props.message || typeof props.message !== 'string') {
    throw new Error('defineEvent requires "message" property');
  }
  if (!props.doc || typeof props.doc !== 'string') {
    throw new Error('defineEvent requires "doc" property');
  }

  const event: EventDefinition = {
    key: props.key,
    level: props.level as 'info' | 'error' | 'warn' | 'debug',
    message: props.message,
    doc: props.doc,
  };

  if (props.fields) {
    return {
      ...event,
      fields: props.fields as Record<string, FieldBuilder<string, boolean>>,
    };
  }

  return event;
}

/**
 * Extract properties from an object literal expression
 */
function extractObjectProperties(obj: ts.ObjectLiteralExpression): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  obj.properties.forEach((prop) => {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      const name = prop.name.text;
      props[name] = extractValue(prop.initializer);
    }
  });

  return props;
}

/**
 * Extract value from an expression node
 */
function extractValue(node: ts.Expression): unknown {
  // String literal
  if (ts.isStringLiteral(node)) {
    return node.text;
  }

  // Numeric literal
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }

  // Boolean literals
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  // Object literal (nested)
  if (ts.isObjectLiteralExpression(node)) {
    return extractObjectProperties(node);
  }

  // Array literal
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(extractValue);
  }

  // For other expressions, return string representation
  // This handles template literals, computed values, etc.
  return node.getText();
}
