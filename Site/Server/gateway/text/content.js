/**
 * Holds text content from the request.
 * In the new flow, frontend already extracted text client-side,
 * so this just validates and returns req.body.text.
 */
export function createTextHolder() {
  return async function holdText({ req, source, parsedText }) {
    let textContent;
    if (source === 'file') {
      textContent = parsedText;
    } else {
      textContent = req.body?.text;
      if (!textContent || typeof textContent !== 'string') {
        throw new Error('No text provided');
      }
    }
    return textContent;
  };
}
