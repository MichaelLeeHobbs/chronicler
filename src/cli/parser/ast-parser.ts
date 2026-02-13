/**
 * AST parser for extracting event definitions from TypeScript files
 */

import fs from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';

import type { EventDefinition } from '../../core/events';
import type { FieldBuilder } from '../../core/fields';
import type { ParsedEventGroup, ParsedEventTree, ValidationError } from '../types';

/**
 * Parse events file and extract all event definitions
 */
export function parseEventsFile(filePath: string): ParsedEventTree {
  const absolutePath = path.resolve(filePath);

  const sourceText = fs.readFileSync(absolutePath, 'utf-8');

  // Use createSourceFile for syntax-only parsing — no import resolution needed,
  // and setParentNodes ensures getText() works on all nodes
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const events: EventDefinition[] = [];
  const groups: ParsedEventGroup[] = [];
  const errors: ValidationError[] = [];

  // Visit all nodes in the AST
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      try {
        const group = extractGroupFromCallExpression(node);
        if (group) {
          groups.push(group);
        }
      } catch (error) {
        let line = 0;
        let character = 0;
        try {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
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

      try {
        const extracted = extractFromCallExpression(node);
        if (extracted) {
          events.push(extracted);
        }
      } catch (error) {
        let line = 0;
        let character = 0;
        try {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
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
    groups,
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
 * Unwrap `as const` assertion from an expression node
 */
function unwrapAsConst(node: ts.Expression): ts.Expression {
  return ts.isAsExpression(node) ? node.expression : node;
}

/**
 * Extract event group from a defineEventGroup or defineCorrelationGroup call
 */
function extractGroupFromCallExpression(node: ts.CallExpression): ParsedEventGroup | null {
  if (!ts.isIdentifier(node.expression)) {
    return null;
  }

  const functionName = node.expression.text;
  if (functionName !== 'defineEventGroup' && functionName !== 'defineCorrelationGroup') {
    return null;
  }

  const arg = unwrapAsConst(node.arguments[0]!);
  if (!ts.isObjectLiteralExpression(arg)) {
    return null;
  }

  let key: string | undefined;
  let type: string | undefined;
  let doc: string | undefined;
  let timeout: number | undefined;
  let events: Record<string, EventDefinition> = {};
  let nestedGroups: Record<string, ParsedEventGroup> = {};

  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      continue;
    }

    const name = prop.name.text;

    switch (name) {
      case 'key':
      case 'type':
      case 'doc': {
        const val = extractValue(prop.initializer);
        if (typeof val === 'string') {
          if (name === 'key') key = val;
          else if (name === 'type') type = val;
          else doc = val;
        }
        break;
      }
      case 'timeout': {
        const val = extractValue(prop.initializer);
        if (typeof val === 'number') {
          timeout = val;
        }
        break;
      }
      case 'events':
        events = extractNestedEvents(prop.initializer);
        break;
      case 'groups':
        nestedGroups = extractNestedGroups(prop.initializer);
        break;
    }
  }

  if (!key || !type || !doc) {
    return null;
  }

  const group: ParsedEventGroup = {
    key,
    type: type as 'system' | 'correlation',
    doc,
    events,
    groups: nestedGroups,
  };

  if (timeout !== undefined) {
    group.timeout = timeout;
  }

  return group;
}

/**
 * Extract inline defineEvent() calls from an events object literal
 */
function extractNestedEvents(node: ts.Expression): Record<string, EventDefinition> {
  const result: Record<string, EventDefinition> = {};
  const unwrapped = unwrapAsConst(node);

  if (!ts.isObjectLiteralExpression(unwrapped)) {
    return result;
  }

  for (const prop of unwrapped.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      continue;
    }

    const name = prop.name.text;
    const valueNode = unwrapAsConst(prop.initializer);

    // Handle inline defineEvent() calls
    if (ts.isCallExpression(valueNode)) {
      const event = extractFromCallExpression(valueNode);
      if (event) {
        result[name] = event;
      }
    }
    // Variable references (e.g. `startup: startupEvent`) cannot be resolved statically — skip
  }

  return result;
}

/**
 * Extract nested group definitions from a groups object literal
 */
function extractNestedGroups(node: ts.Expression): Record<string, ParsedEventGroup> {
  const result: Record<string, ParsedEventGroup> = {};
  const unwrapped = unwrapAsConst(node);

  if (!ts.isObjectLiteralExpression(unwrapped)) {
    return result;
  }

  for (const prop of unwrapped.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      continue;
    }

    const name = prop.name.text;
    const valueNode = unwrapAsConst(prop.initializer);

    if (ts.isCallExpression(valueNode)) {
      const group = extractGroupFromCallExpression(valueNode);
      if (group) {
        result[name] = group;
      }
    }
  }

  return result;
}

/**
 * Extract a field builder from a t.string().optional().doc('...') method chain.
 * Returns a FieldBuilder-shaped object or null if the node isn't a field builder chain.
 */
function extractFieldBuilder(
  node: ts.Expression,
): { _type: string; _required: boolean; _doc: string | undefined } | null {
  let type: string | undefined;
  let required = true;
  let doc: string | undefined;
  let current: ts.Expression = node;

  // Walk the method chain from outermost to innermost call
  while (ts.isCallExpression(current)) {
    const expr = current.expression;
    if (!ts.isPropertyAccessExpression(expr)) {
      break;
    }

    const methodName = expr.name.text;

    if (methodName === 'optional') {
      required = false;
    } else if (methodName === 'doc') {
      const arg = current.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        doc = arg.text;
      }
    } else if (ts.isIdentifier(expr.expression) && expr.expression.text === 't') {
      // Base of the chain: t.string(), t.number(), etc.
      type = methodName;
    }

    current = expr.expression;
  }

  if (!type) {
    return null;
  }

  return { _type: type, _required: required, _doc: doc };
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

  // Field builder chain: t.string(), t.number().optional().doc('...')
  if (ts.isCallExpression(node)) {
    const fieldBuilder = extractFieldBuilder(node);
    if (fieldBuilder) {
      return fieldBuilder;
    }
  }

  // For other expressions (template literals, computed values, etc.),
  // return the source text representation
  try {
    return node.getText();
  } catch {
    return undefined;
  }
}
