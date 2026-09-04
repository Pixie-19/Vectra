export type Address = `0x${string}`;

export type Group = {
  id: string;
  name: string;
  creator: Address;
  members: Address[];
};

export function createGroup(
  id: string,
  name: string,
  creator: Address,
  members: Address[],
): Group {
  if (id.trim() === "") {
    throw new Error("Group ID cannot be empty");
  }

  if (name.trim() === "") {
    throw new Error("Group name cannot be empty");
  }

  if (members.length < 2) {
    throw new Error("A group must have at least 2 members");
  }

  const uniqueMembers = new Set(members);

  if (uniqueMembers.size !== members.length) {
    throw new Error("Group members must be unique");
  }

  if (!uniqueMembers.has(creator)) {
    throw new Error("Creator must be a group member");
  }

  return {
    id,
    name,
    creator,
    members: [...members],
  };
}