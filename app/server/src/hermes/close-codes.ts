const SERVICE_RESTART = 1012

/** Close codes a server may send; everything else (1005/1006 = no status / abnormal) becomes 1012. */
export function forwardableCode(code: number): number {
  const valid = (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011) || (code >= 3000 && code <= 4999)
  return valid ? code : SERVICE_RESTART
}
