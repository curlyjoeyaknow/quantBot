#!/usr/bin/env tsx
/**
 * Create Linear Issues from TODO.md
 *
 * Uses Linear's GraphQL API to create issues for incomplete TODO items.
 */

import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { gql, GraphQLClient } from 'graphql-request';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

interface TodoItem {
  title: string;
  description: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  subItems: TodoItem[];
}

// GraphQL queries
const GET_TEAMS = gql`
  query {
    teams {
      nodes {
        id
        key
        name
      }
    }
  }
`;

const GET_PROJECT = gql`
  query GetProject($filter: ProjectFilter) {
    project(filter: $filter) {
      id
      name
    }
  }
`;

const CREATE_ISSUE = gql`
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        title
        url
      }
    }
  }
`;

function parseTodoMarkdown(content: string): TodoItem[] {
  const items: TodoItem[] = [];
  const lines = content.split('\n');

  let currentCategory = 'General';
  let currentPriority: 'high' | 'medium' | 'low' = 'medium';
  let currentSection = '';
  let stack: Array<{ item: TodoItem; level: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect category sections
    if (line.startsWith('### ')) {
      currentSection = line.replace(/^###\s+/, '').trim();

      // Determine priority from section
      if (currentSection.includes('High Priority') || currentSection.includes('Next Steps')) {
        currentPriority = 'high';
      } else if (currentSection.includes('Medium Priority')) {
        currentPriority = 'medium';
      } else if (currentSection.includes('Low Priority') || currentSection.includes('Backlog')) {
        currentPriority = 'low';
      }

      // Extract category name
      currentCategory = currentSection.replace(/^.*?[-–]\s*/, '').trim();
      if (!currentCategory || currentCategory === currentSection) {
        currentCategory = currentSection;
      }
    }

    // Detect todo items
    const todoMatch = line.match(/^(\s*)- \[([ xX])\] (.+)$/);
    if (todoMatch) {
      const indent = todoMatch[1].length;
      const completed = todoMatch[2].toLowerCase() === 'x';
      const title = todoMatch[3].trim();

      // Skip completed items
      if (completed) {
        continue;
      }

      const item: TodoItem = {
        title,
        description: extractDescription(lines, i),
        category: currentCategory,
        priority: currentPriority,
        completed: false,
        subItems: [],
      };

      // Find parent based on indent level
      while (stack.length > 0 && stack[stack.length - 1].level >= indent) {
        stack.pop();
      }

      if (stack.length === 0) {
        items.push(item);
        stack.push({ item, level: indent });
      } else {
        const parent = stack[stack.length - 1].item;
        parent.subItems.push(item);
        stack.push({ item, level: indent });
      }
    }
  }

  return items;
}

function extractDescription(lines: string[], startIndex: number): string {
  const description: string[] = [];
  let i = startIndex + 1;

  // Collect following lines until next todo or heading
  while (i < lines.length) {
    const line = lines[i];

    // Stop at next todo item or heading
    if (line.match(/^(\s*)- \[([ xX])\]/) || line.match(/^#{1,3}\s/)) {
      break;
    }

    // Collect non-empty lines
    const trimmed = line.trim();
    if (trimmed && !trimmed.match(/^[-*]\s*$/)) {
      description.push(trimmed);
    }

    i++;
  }

  return description.join('\n').trim();
}

function mapPriority(priority: 'high' | 'medium' | 'low'): number {
  switch (priority) {
    case 'high':
      return 1; // Urgent
    case 'medium':
      return 2; // High
    case 'low':
      return 4; // Low
    default:
      return 3; // Medium
  }
}

async function getTeam(client: GraphQLClient, teamKey: string = 'QB'): Promise<string | null> {
  try {
    const data = await client.request<{
      teams: { nodes: Array<{ id: string; key: string; name: string }> };
    }>(GET_TEAMS);
    const team = data.teams.nodes.find(
      (t) => t.key === teamKey || t.name.toLowerCase().includes('quantbot')
    );
    return team?.id || data.teams.nodes[0]?.id || null;
  } catch (error) {
    console.error('Error fetching teams:', error);
    return null;
  }
}

async function getProject(
  client: GraphQLClient,
  projectName: string = 'quantBot'
): Promise<string | null> {
  try {
    const data = await client.request<{ project: { id: string; name: string } | null }>(
      GET_PROJECT,
      {
        filter: { name: { eq: projectName } },
      }
    );
    return data.project?.id || null;
  } catch (error) {
    console.warn('Could not find project, creating issues without project:', error);
    return null;
  }
}

async function createIssue(
  client: GraphQLClient,
  item: TodoItem,
  teamId: string,
  projectId: string | null,
  parentId: string | null = null
): Promise<string | null> {
  try {
    // Clean up title (remove markdown formatting)
    const title = item.title.replace(/\*\*/g, '').replace(/`/g, '').trim();

    // Build description
    let description = item.description || '';
    if (description) {
      description = `**Category:** ${item.category}\n\n${description}`;
    } else {
      description = `**Category:** ${item.category}`;
    }

    // Add sub-items to description if any
    if (item.subItems.length > 0) {
      description += '\n\n**Sub-tasks:**\n';
      for (const subItem of item.subItems) {
        description += `- ${subItem.title.replace(/\*\*/g, '').replace(/`/g, '')}\n`;
      }
    }

    const input: any = {
      teamId,
      title,
      description,
      priority: mapPriority(item.priority),
      labelIds: [], // You can add label IDs here if you have labels set up
    };

    if (projectId) {
      input.projectId = projectId;
    }

    if (parentId) {
      input.parentId = parentId;
    }

    const data = await client.request<{
      issueCreate: {
        success: boolean;
        issue: { id: string; identifier: string; title: string; url: string } | null;
        error: { message: string } | null;
      };
    }>(CREATE_ISSUE, { input });

    if (data.issueCreate.success && data.issueCreate.issue) {
      return data.issueCreate.issue.id;
    } else {
      console.error('Failed to create issue:', data.issueCreate.error?.message || 'Unknown error');
      return null;
    }
  } catch (error: any) {
    console.error(`Error creating issue "${item.title}":`, error.message);
    return null;
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.LINEAR_API_KEY || process.argv[2];

  if (!apiKey) {
    console.error('❌ Linear API key required!');
    console.error('   Usage: LINEAR_API_KEY=your_key tsx create-linear-issues.ts');
    console.error('   Or:    tsx create-linear-issues.ts your_key');
    process.exit(1);
  }

  const client = new GraphQLClient(LINEAR_API_URL, {
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
  });

  console.log('🔗 Connecting to Linear...\n');

  // Get team
  const teamId = await getTeam(client, 'QB');
  if (!teamId) {
    console.error('❌ Could not find team. Please check your API key and team setup.');
    process.exit(1);
  }
  console.log(`✅ Using team: ${teamId}`);

  // Try to find project (optional)
  const projectId = await getProject(client, 'quantBot');
  if (projectId) {
    console.log(`✅ Using project: ${projectId}`);
  } else {
    console.log('ℹ️  No project found, creating issues without project assignment');
  }
  console.log('');

  // Parse TODO.md
  const rootDir = resolve(process.cwd());
  const todoPath = join(rootDir, 'TODO.md');

  console.log('📋 Parsing TODO.md...\n');
  const content = await readFile(todoPath, 'utf-8');
  const items = parseTodoMarkdown(content);

  console.log(`Found ${items.length} top-level items to create\n`);

  // Create issues
  const createdIssues: Array<{ title: string; id: string; url?: string }> = [];
  const failedIssues: Array<{ title: string; error: string }> = [];

  for (const item of items) {
    console.log(`📌 Creating: ${item.title}`);

    // Create parent issue
    const parentId = await createIssue(client, item, teamId, projectId);

    if (parentId) {
      createdIssues.push({ title: item.title, id: parentId });
      console.log(`   ✅ Created (${parentId})`);

      // Create sub-issues
      for (const subItem of item.subItems) {
        console.log(`   📌 Creating sub-task: ${subItem.title}`);
        const subId = await createIssue(client, subItem, teamId, projectId, parentId);

        if (subId) {
          createdIssues.push({ title: subItem.title, id: subId });
          console.log(`      ✅ Created (${subId})`);
        } else {
          failedIssues.push({ title: subItem.title, error: 'Failed to create' });
          console.log(`      ❌ Failed`);
        }
      }
    } else {
      failedIssues.push({ title: item.title, error: 'Failed to create' });
      console.log(`   ❌ Failed`);
    }

    console.log('');

    // Rate limiting - Linear API has rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Summary
  console.log('\n📊 Summary:');
  console.log(`   ✅ Created: ${createdIssues.length} issues`);
  console.log(`   ❌ Failed: ${failedIssues.length} issues`);

  if (failedIssues.length > 0) {
    console.log('\n❌ Failed issues:');
    for (const failed of failedIssues) {
      console.log(`   - ${failed.title}: ${failed.error}`);
    }
  }

  console.log('\n🎉 Done! Check Linear for your new issues.');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
