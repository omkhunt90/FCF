/**
 * Code Debugging — per-error evaluation service.
 *
 * Evaluates participant's submitted code against the error definitions.
 * Accurately detects each of the 10 errors by semantic pattern analysis
 * and regex checks.
 */

export interface ErrorDefinition {
  id: number | string;
  description?: string;
  message?: string;
  fixRegex?: string;
  bugRegex?: string;
  errorSnippet?: string;
}

export interface ErrorCheckResult {
  id: number | string;
  description: string;
  fixed: boolean;
}

export interface DebugDiffResult {
  errorsChecked: ErrorCheckResult[];
  fixedCount: number;
  score: number;
}

function checkKnownError(
  errId: string,
  desc: string,
  code: string,
  _starterCode?: string | null
): boolean | null {
  const normId = (errId || '').toUpperCase();
  const normDesc = (desc || '').toLowerCase();

  // 1. Macro precedence: #define SQUARE(x) x * x
  if (normId.includes('MACRO') || normDesc.includes('macro') || normDesc.includes('precedence')) {
    const hasParenthesizedX = /#define\s+SQUARE\s*\(\s*x\s*\)\s*\(?\s*\(\s*x\s*\)\s*\*\s*\(\s*x\s*\)\s*\)?/i.test(code);
    const hasBuggyMacro = /#define\s+SQUARE\s*\(\s*x\s*\)\s*x\s*\*\s*x\b/i.test(code);
    return hasParenthesizedX || (!hasBuggyMacro && /#define\s+SQUARE/i.test(code));
  }

  // 2. Malloc NULL check missing
  if (normId.includes('MALLOC_CHECK') || (normDesc.includes('null') && (normDesc.includes('malloc') || normDesc.includes('allocation') || normDesc.includes('pointer')))) {
    return /if\s*\(\s*(?:arr\s*==\s*NULL|NULL\s*==\s*arr|!\s*arr|arr\s*==\s*0)\s*\)/i.test(code);
  }

  // 3. Off-by-one loop indexing: for (int i = 1; i <= size; i++)
  if (normId.includes('OFF_BY_ONE') || normId.includes('LOOP') || normDesc.includes('loop') || normDesc.includes('off-by-one') || normDesc.includes('traversal')) {
    const hasFixedLoop = /for\s*\(\s*(?:int\s+)?i\s*=\s*0\s*;\s*i\s*<\s*size\s*;\s*i\s*\+\+\s*\)/i.test(code) ||
                         /for\s*\(\s*(?:int\s+)?i\s*=\s*0\s*;\s*i\s*<=\s*size\s*-\s*1\s*;\s*i\s*\+\+\s*\)/i.test(code);
    const hasBuggyLoop = /for\s*\(\s*(?:int\s+)?i\s*=\s*1\s*;\s*i\s*<=\s*size\s*;\s*i\s*\+\+\s*\)/i.test(code);
    return hasFixedLoop || (!hasBuggyLoop && /arr\[i\]/i.test(code));
  }

  // 4. Scanf missing ampersand (&)
  if (normId.includes('SCANF') || normId.includes('AMPERSAND') || normDesc.includes('scanf') || normDesc.includes('ampersand') || normDesc.includes('address-of')) {
    const hasAmpersand = /scanf\s*\(\s*"%d"\s*,\s*&\s*search\s*\)/i.test(code);
    const hasMissingAmpersand = /scanf\s*\(\s*"%d"\s*,\s*search\s*\)/i.test(code);
    return hasAmpersand && !hasMissingAmpersand;
  }

  // 5. Accidental assignment in if condition: if (search = arr[size])
  if (normId.includes('ASSIGNMENT') || (normDesc.includes('assignment') && normDesc.includes('comparison')) || (normDesc.includes('=') && normDesc.includes('conditional'))) {
    const hasEquality = /if\s*\(\s*(?:search\s*==\s*arr\[|arr\[[^\]]+\]\s*==\s*search)/i.test(code);
    const hasSingleEqual = /if\s*\(\s*search\s*=\s*arr\[/i.test(code);
    return hasEquality && !hasSingleEqual;
  }

  // 6. Out-of-bounds array access: arr[size]
  if (normId.includes('OUT_OF_BOUNDS') || (normDesc.includes('bounds') && (normDesc.includes('array') || normDesc.includes('index') || normDesc.includes('size')))) {
    const hasOutOfBounds = /\barr\s*\[\s*size\s*\]/i.test(code);
    const hasCorrectIndex = /\barr\s*\[\s*(?:size\s*-\s*1|4)\s*\]/i.test(code);
    return hasCorrectIndex || (!hasOutOfBounds && /\barr\[/.test(code));
  }

  // 7. Missing semicolon after printf
  if (normId.includes('SEMICOLON') || normDesc.includes('semicolon')) {
    const hasMissingSemi = /printf\s*\(\s*"Does not match\.\\n"\s*\)\s*(?!\s*;)/i.test(code);
    const hasSemi = /printf\s*\(\s*"Does not match\.\\n"\s*\)\s*;/i.test(code);
    return hasSemi && !hasMissingSemi;
  }

  // 8. Character compared to string literal: grade == "A"
  if (normId.includes('CHAR_STRING') || normDesc.includes('character') || (normDesc.includes('string') && normDesc.includes('grade')) || normDesc.includes('double-quoted')) {
    const hasSingleQuote = /grade\s*==\s*'A'|'A'\s*==\s*grade/i.test(code);
    const hasDoubleQuote = /grade\s*==\s*"A"|"A"\s*==\s*grade/i.test(code);
    return hasSingleQuote && !hasDoubleQuote;
  }

  // 9. Memory leak: free(arr) missing
  if (normId.includes('MEMORY_LEAK') || normDesc.includes('memory leak') || normDesc.includes('released') || normDesc.includes('free')) {
    return /\bfree\s*\(\s*arr\s*\)\s*;/i.test(code);
  }

  // 10. Malloc cast missing: int *arr = malloc(...)
  if (normId.includes('MALLOC_CAST') || normDesc.includes('cast') || normDesc.includes('void pointer') || normDesc.includes('conversion from void')) {
    return /\(\s*int\s*\*\s*\)\s*malloc/i.test(code);
  }

  return null;
}

function evaluateGenericError(
  error: ErrorDefinition,
  code: string,
  starterCode?: string | null
): boolean {
  // If bugRegex is provided: the bug pattern must NO LONGER be present
  if (error.bugRegex) {
    try {
      const bugReg = new RegExp(error.bugRegex, 'ms');
      if (bugReg.test(code)) return false;
    } catch {}
  }

  // If fixRegex is provided
  if (error.fixRegex) {
    try {
      const reg = new RegExp(error.fixRegex, 'ms');
      // If the regex matches the buggy starter code or errorSnippet, it describes the bug!
      const matchesStarter = starterCode ? reg.test(starterCode) : false;
      const matchesSnippet = error.errorSnippet ? reg.test(error.errorSnippet) : false;

      if (matchesStarter || matchesSnippet) {
        // Inverted config: fixRegex was written as the bug pattern
        return !reg.test(code);
      }
      return reg.test(code);
    } catch {
      return false;
    }
  }

  if (error.errorSnippet) {
    return !code.includes(error.errorSnippet.trim());
  }

  return false;
}

export function evaluateDebugging(
  participantCode: string,
  errors: ErrorDefinition[],
  starterCode?: string | null
): DebugDiffResult {
  const errorsChecked: ErrorCheckResult[] = errors.map((error, index) => {
    const errorId = error.id ?? (index + 1);
    const description = error.description || error.message || `Error #${errorId}`;

    const knownResult = checkKnownError(String(errorId), description, participantCode, starterCode);
    let fixed = false;
    if (knownResult !== null) {
      fixed = knownResult;
    } else {
      fixed = evaluateGenericError(error, participantCode, starterCode);
    }

    return {
      id: errorId,
      description,
      fixed,
    };
  });

  const fixedCount = errorsChecked.filter((e) => e.fixed).length;

  return {
    errorsChecked,
    fixedCount,
    score: fixedCount * 10,
  };
}
