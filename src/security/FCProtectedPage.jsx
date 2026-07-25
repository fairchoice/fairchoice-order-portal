import React from "react";
import { hasFcPermission } from "./fcPermissions";

export default function FCProtectedPage({ currentUser, permission, children }) {
  if (!permission) {
    return <div className="p-6">This page has no FC Security permission configured.</div>;
  }

  if (!hasFcPermission(currentUser, permission)) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold">Access denied</h2>
        <p className="mt-2">
          Your FC Staff Identity does not have permission: <strong>{permission}</strong>
        </p>
      </div>
    );
  }

  return children;
}
