import { supabaseServer } from '@/lib/db/server';

export interface SearchFilters {
  query?: string;
  discipline?: string;
  skills?: string[];
  minRate?: number;
  maxRate?: number;
  availability?: 'available' | 'limited' | 'unavailable';
  minRating?: number;
  limit?: number;
  offset?: number;
}

export interface BountyFilters {
  query?: string;
  difficulty?: string;
  category?: string;
  minBudget?: number;
  maxBudget?: number;
  status?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

// Advanced search for creators with multiple filters
export async function searchCreators(filters: SearchFilters) {
  let query = supabaseServer
    .from('creators')
    .select('*, users:user_id(id, email, name, avatar_url)', { count: 'exact' });

  // Text search
  if (filters.query) {
    query = query.ilike('bio', `%${filters.query}%`)
      .or(`title.ilike.%${filters.query}%`);
  }

  // Filter by discipline
  if (filters.discipline) {
    query = query.eq('discipline', filters.discipline);
  }

  // Filter by skills (array contains)
  if (filters.skills && filters.skills.length > 0) {
    // Note: This assumes skills are stored as an array type in Supabase
    query = query.contains('skills', filters.skills);
  }

  // Filter by hourly rate range
  if (filters.minRate !== undefined) {
    query = query.gte('hourly_rate', filters.minRate);
  }
  
  if (filters.maxRate !== undefined) {
    query = query.lte('hourly_rate', filters.maxRate);
  }

  // Filter by availability
  if (filters.availability) {
    query = query.eq('availability', filters.availability);
  }

  // Filter by minimum rating
  if (filters.minRating !== undefined) {
    query = query.gte('rating', filters.minRating);
  }

  // Apply sorting and pagination
  const limit = filters.limit || 10;
  const offset = filters.offset || 0;

  query = query
    .order('rating', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  return { data, error, count, limit, offset };
}

// Advanced search for bounties with multiple filters
export async function searchBounties(filters: BountyFilters) {
  let query = supabaseServer
    .from('bounties')
    .select('*', { count: 'exact' });

  // Text search
  if (filters.query) {
    query = query.ilike('title', `%${filters.query}%`)
      .or(`description.ilike.%${filters.query}%`);
  }

  // Filter by difficulty
  if (filters.difficulty) {
    query = query.eq('difficulty', filters.difficulty);
  }

  // Filter by category
  if (filters.category) {
    query = query.eq('category', filters.category);
  }

  // Filter by budget range
  if (filters.minBudget !== undefined) {
    query = query.gte('budget', filters.minBudget);
  }

  if (filters.maxBudget !== undefined) {
    query = query.lte('budget', filters.maxBudget);
  }

  // Filter by status
  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  // Filter by tags (array overlaps)
  if (filters.tags && filters.tags.length > 0) {
    query = query.overlaps('tags', filters.tags);
  }

  // Apply sorting and pagination
  const limit = filters.limit || 10;
  const offset = filters.offset || 0;

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  return { data, error, count, limit, offset };
}

// Get search suggestions for autocomplete
export async function getCreatorSearchSuggestions(query: string) {
  if (query.length < 2) {
    return [];
  }

  const { data } = await supabaseServer
    .from('creators')
    .select('id, title, bio, skills')
    .ilike('title', `%${query}%`)
    .limit(5);

  return data || [];
}

// Parse search operators (e.g., "discipline:design skill:figma")
export function parseSearchOperators(query: string): SearchFilters {
  const filters: SearchFilters = {};
  const parts = query.split(' ');
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.includes(':')) {
      const [key, value] = part.split(':');
      
      switch (key) {
        case 'discipline':
          filters.discipline = value;
          break;
        case 'skill':
          filters.skills = filters.skills || [];
          filters.skills.push(value);
          break;
        case 'minrate':
          filters.minRate = parseInt(value);
          break;
        case 'maxrate':
          filters.maxRate = parseInt(value);
          break;
        case 'rating':
          filters.minRating = parseFloat(value);
          break;
        case 'availability':
          filters.availability = value as 'available' | 'limited' | 'unavailable';
          break;
        default:
          textParts.push(part);
      }
    } else {
      textParts.push(part);
    }
  }

  filters.query = textParts.join(' ');
  return filters;
}
