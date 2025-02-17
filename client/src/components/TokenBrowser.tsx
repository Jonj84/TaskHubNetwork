import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from 'date-fns';
import { Search, Award, Clock, Filter } from 'lucide-react';
import type { Token } from '../lib/blockchain/types';
import { motion } from 'framer-motion';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Badge } from "./ui/badge";

interface TokenBrowserProps {
  tokens: Token[];
  isLoading?: boolean;
}

type SortField = 'newest' | 'oldest' | 'id' | 'status';
type FilterStatus = 'all' | 'active' | 'escrow';

export function TokenBrowser({ tokens, isLoading }: TokenBrowserProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('newest');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [creatorSearch, setCreatorSearch] = useState('');

  const filteredAndSortedTokens = useMemo(() => {
    let result = [...tokens];

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter(token => token.status === statusFilter);
    }

    // Apply search filters
    if (search || creatorSearch) {
      const searchLower = search.toLowerCase();
      const creatorLower = creatorSearch.toLowerCase();

      result = result.filter(token => {
        const matchesSearch = !search || 
          token.id.toLowerCase().includes(searchLower) ||
          token.metadata?.mintedInBlock?.toString().includes(searchLower);

        const matchesCreator = !creatorSearch ||
          token.creator?.toLowerCase().includes(creatorLower);

        return matchesSearch && matchesCreator;
      });
    }

    // Sort tokens
    result.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.metadata?.createdAt || 0).getTime() - 
                 new Date(a.metadata?.createdAt || 0).getTime();
        case 'oldest':
          return new Date(a.metadata?.createdAt || 0).getTime() - 
                 new Date(b.metadata?.createdAt || 0).getTime();
        case 'id':
          return a.id.localeCompare(b.id);
        case 'status':
          return (a.status || '').localeCompare(b.status || '');
        default:
          return 0;
      }
    });

    return result;
  }, [tokens, search, sortBy, statusFilter, creatorSearch]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Token Browser</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-48 bg-muted rounded"></div>
              <div className="grid grid-cols-3 gap-4">
                <div className="h-24 w-full bg-muted rounded"></div>
                <div className="h-24 w-full bg-muted rounded"></div>
                <div className="h-24 w-full bg-muted rounded"></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeFilters = [
    statusFilter !== 'all' && `Status: ${statusFilter}`,
    search && `Search: ${search}`,
    creatorSearch && `Creator: ${creatorSearch}`,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            Token Browser
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {filteredAndSortedTokens.length} of {tokens.length} tokens
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Search and Filter Controls */}
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by token ID or block..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select
                value={sortBy}
                onValueChange={(value) => setSortBy(value as SortField)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest First</SelectItem>
                  <SelectItem value="oldest">Oldest First</SelectItem>
                  <SelectItem value="id">Token ID</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-[120px]">
                    <Filter className="h-4 w-4 mr-2" />
                    Filters
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={statusFilter === 'all'}
                    onCheckedChange={() => setStatusFilter('all')}
                  >
                    All Tokens
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={statusFilter === 'active'}
                    onCheckedChange={() => setStatusFilter('active')}
                  >
                    Active Only
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={statusFilter === 'escrow'}
                    onCheckedChange={() => setStatusFilter('escrow')}
                  >
                    In Escrow
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
              >
                {showAdvancedSearch ? 'Simple Search' : 'Advanced Search'}
              </Button>
            </div>

            {showAdvancedSearch && (
              <div className="flex gap-4">
                <div className="relative flex-1">
                  <Input
                    placeholder="Search by creator..."
                    value={creatorSearch}
                    onChange={(e) => setCreatorSearch(e.target.value)}
                  />
                </div>
              </div>
            )}

            {activeFilters.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {activeFilters.map((filter, index) => (
                  <Badge key={index} variant="secondary">
                    {filter}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Token Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedTokens.map((token, index) => (
              <TooltipProvider key={token.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card className="hover:shadow-md transition-shadow cursor-help">
                        <CardContent className="pt-6">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Token ID</span>
                              <span className="text-xs font-mono text-muted-foreground">
                                {token.id.substring(0, 8)}...
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Status</span>
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                                ${token.status === 'active' ? 'bg-green-100 text-green-800' :
                                token.status === 'escrow' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'}`}>
                                {token.status.charAt(0).toUpperCase() + token.status.slice(1)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">Created</span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(token.metadata?.createdAt || 0), 'MMM d, yyyy')}
                              </span>
                            </div>
                            {token.creator && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Creator</span>
                                <span className="text-xs text-muted-foreground font-mono">
                                  {token.creator}
                                </span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="p-4 space-y-2 max-w-xs">
                    <p className="font-medium">Token Details</p>
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="text-muted-foreground">Full ID:</span>{' '}
                        <span className="font-mono">{token.id}</span>
                      </p>
                      <p>
                        <span className="text-muted-foreground">Creator:</span>{' '}
                        {token.creator}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Block:</span>{' '}
                        {token.metadata?.mintedInBlock || 'Unknown'}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Created:</span>{' '}
                        {format(new Date(token.metadata?.createdAt || 0), 'PPpp')}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Previous Transfers:</span>{' '}
                        {token.metadata?.previousTransfers?.length || 0}
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>

          {/* Empty State */}
          {filteredAndSortedTokens.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-lg font-medium">No tokens found</p>
              <p className="text-sm text-muted-foreground">
                {search || creatorSearch || statusFilter !== 'all' ? 
                  'Try adjusting your search filters' : 
                  'Your tokens will appear here'}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}