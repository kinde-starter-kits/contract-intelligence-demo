'use client';

import {useState} from 'react';
import {RunConsole} from './RunConsole';
import {MapsToApp} from './MapsToApp';
import {LiveTape} from './LiveTape';

/**
 * The review stage: the run console (mode + run) beside the live timeline. This
 * thin client wrapper only shares the run's error state so a failed run shows a
 * clear banner in the timeline instead of a frozen stream — it does NOT change
 * how a run is triggered or enforced (that stays in RunConsole/`/api/run`).
 */
export function ReviewWorkbench({
  contractId,
  actorNoun,
  actorCanApprove,
  crewAvailable = false
}: {
  contractId: string;
  actorNoun: string;
  actorCanApprove: boolean;
  crewAvailable?: boolean;
}) {
  const [runError, setRunError] = useState<string | null>(null);

  return (
    <div className="stage-grid">
      <div className="rail">
        <RunConsole
          contractId={contractId}
          crewAvailable={crewAvailable}
          onStart={() => setRunError(null)}
          onError={setRunError}
        />
        <MapsToApp />
      </div>
      <LiveTape
        contractId={contractId}
        actorNoun={actorNoun}
        actorCanApprove={actorCanApprove}
        runError={runError}
      />
    </div>
  );
}
