export default function OrgNode({ person }) {
  return (
    <div className="org-node">
      <span className={`status-dot status-${person.status}`} title={person.status} />
      <div className="avatar" style={{ background: person.avatarColor }}>
        {person.avatarInitial}
      </div>
      <div className="who">
        <div className="nm">{person.name}{person.isHuman ? " (You)" : ""}</div>
        <div className="ti">{person.title}</div>
        <div className="task">{person.currentTask}</div>
      </div>
    </div>
  );
}
