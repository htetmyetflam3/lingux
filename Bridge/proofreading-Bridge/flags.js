/* PART: flags — hard-coded, no .env, no argv parsing.

   TWO KEYS, one per direction of the two-phase handshake:

   CALLER_KEY (pub/answer side, CLI.js = hidden.js stand-in)
     - presented by the caller on PHASE 1 (POST /fsm, x-api-key)
     - the engine holds the same value as flags.apiKey — the answer

   ENGINE_KEY (secret side, engine)
     - presented BY THE ENGINE on PHASE 2 (the collect call back to the
       caller's fileUrl)
     - the caller holds the same value as flags.engineKeyAnswer to verify
       the engine collecting is ours

   Write flags mirror the MAIN branch (WRITE_SYLLABLE / WRITE_POS) so the
   api part migrates into main unchanged. The id observability outputs
   carry NO flag — dev stage always writes them.
*/

export const FLAGS = {
	/* engine host */
	port: 9000,
	mount: "/fsm",
	apiKey: "58b6a7310a21557b3dc7ebfce4936c3e", // answer to the caller's key
	engineKey: "cac7f2817b0edeb996980ecac6432bd4", // secret the engine presents on collect

	/* caller side (CLI.js = hidden.js + praser stand-in) */
	sitePort: 3000,
	KeyAnswer: "cac7f2817b0edeb996980ecac6432bd4", // verifies the engine's collect
	Endpoint: "http://localhost:3000/result",

	/* write flags — main branch shape (WRITE_SYLLABLE / WRITE_POS) */
	writeSyllable: true,
	writePos: true,

	/* handshake payload — hidden.js shape (CLI sends these on phase 1) */
	fileName: "input.txt",
	userId: 1,
	sessionId: 22,
	formId: "form-cli-local",
	submitId: "submit-cli-local",
	source: "cli",
	status: "pending",

	/* the file the caller serves on collect (local retrieve stand-in;
	   the ENGINE itself only ever reads the tmp file staged from the api) */
	input: "input/input.txt",
};
