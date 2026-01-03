import { MapPin, Briefcase, DollarSign, ExternalLink, Calendar } from 'lucide-react';

interface JobCardProps {
  job: any; // We'll improve this with actual types from AppRouter later
}

export function JobCard({ job }: JobCardProps) {
  const formatSalary = (min: number | null, max: number | null, currency: string | null) => {
    if (!min && !max) return 'Competitive';
    const cur = currency || '$';
    if (min && max) return `${cur}${min.toLocaleString()} - ${max.toLocaleString()}`;
    return `${cur}${(min || max)!.toLocaleString()}+`;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">{job.job_title}</h3>
          <p className="text-lg font-medium text-primary uppercase tracking-wide">{job.company_name}</p>
        </div>
        <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-1 rounded border border-blue-100">
          {job.role_level}
        </span>
      </div>

      {job.summary && (
        <div className="bg-gray-50 border-l-4 border-primary/30 p-4 mb-6 rounded-r-md">
          <p className="text-gray-700 text-sm leading-relaxed">
            {job.summary}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 text-gray-600 text-sm">
        <div className="flex items-center gap-2">
          <MapPin size={16} />
          <span>{job.location} ({job.remote_status})</span>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign size={16} />
          <span>{formatSalary(job.salary_min, job.salary_max, job.salary_currency)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Briefcase size={16} />
          <span>{job.is_manager ? 'Management Role' : 'Individual Contributor'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} />
          <span>Added {new Date(job.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {/* We'll need to parse the technologies string/array here */}
        {Array.isArray(job.technologies) ? job.technologies.map((tech: string) => (
          <span key={tech} className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-medium">
            {tech}
          </span>
        )) : null}
      </div>

      <button className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white py-2 rounded-md font-semibold hover:bg-gray-800 transition-colors">
        View Job Details <ExternalLink size={16} />
      </button>
    </div>
  );
}
