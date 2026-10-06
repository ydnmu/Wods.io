// A failed metadata request must not release usage or the worker slot while
// its sibling transcript provider can still run and reserve fallback hours.
export async function awaitJobInputs<Metadata, Transcript>(
  metadata: Promise<Metadata>,
  transcript: Promise<Transcript>,
): Promise<[Metadata, Transcript]> {
  const [metaResult, transcriptResult] = await Promise.allSettled([metadata, transcript])
  if (metaResult.status === 'rejected' && transcriptResult.status === 'rejected') {
    throw new AggregateError([metaResult.reason, transcriptResult.reason], 'job_inputs_failed')
  }
  if (metaResult.status === 'rejected') throw metaResult.reason
  if (transcriptResult.status === 'rejected') throw transcriptResult.reason
  return [metaResult.value, transcriptResult.value]
}
