'use client';

import Link from 'next/link';
import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';

const STATUS_CLASS: Record<string, string> = {
  uploaded: '',
  reviewing: 'warn',
  reviewed: 'ok'
};

export function Contracts({orgCode}: {orgCode: string}) {
  const contracts = useQuery(api.contracts.listContractsByOrg, {orgCode});
  return (
    <div className="card">
      <h2>
        Contracts <span className="sub">org {orgCode}</span>
      </h2>
      {contracts === undefined ? (
        <div className="empty">Loading…</div>
      ) : contracts.length === 0 ? (
        <div className="empty">No contracts yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c._id}>
                <td>
                  <Link href={`/dashboard/contracts/${c._id}`}>{c.title}</Link>
                </td>
                <td>
                  <span className={`badge ${STATUS_CLASS[c.status] ?? ''}`}>
                    {c.status}
                  </span>
                </td>
                <td className="muted">
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
