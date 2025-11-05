using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ChessServer.Data
{
    public sealed class ApplicationUser : IdentityUser<Guid>
    {
        public string DisplayName { get; set; } = string.Empty;
        public ICollection<GameParticipant> Participations { get; set; } = new List<GameParticipant>();
    }

    public sealed class ApplicationRole : IdentityRole<Guid> { }

    public sealed class ApplicationUserRole : IdentityUserRole<Guid>
    {
        public ApplicationUser User { get; set; } = null!;
        public ApplicationRole Role { get; set; } = null!;
    }

    public sealed class Game
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Code { get; set; } = string.Empty;
        public string Fen { get; set; } = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        public string Castling { get; set; } = "KQkq";
        public string Turn { get; set; } = "w";
        public int Halfmove { get; set; }
        public int Fullmove { get; set; } = 1;
        public string? Outcome { get; set; }
        public string? Reason { get; set; }
        public string Status { get; set; } = "waiting"; // waiting, active, finished
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public ICollection<Move> History { get; set; } = new List<Move>();
        public ICollection<GameParticipant> Participants { get; set; } = new List<GameParticipant>();
    }

    public sealed class Move
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid GameId { get; set; }
        public Game Game { get; set; } = null!;
        public int Index { get; set; }
        public int From { get; set; }
        public int To { get; set; }
        public string? Flags { get; set; }
        public string? Promotion { get; set; }
        public string FenAfter { get; set; } = string.Empty;
        public string? Outcome { get; set; }
        public string? Reason { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public sealed class GameParticipant
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid GameId { get; set; }
        public Game Game { get; set; } = null!;
        public Guid UserId { get; set; }
        public ApplicationUser User { get; set; } = null!;
        public string Color { get; set; } = "w";
        public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    }

    public sealed class AppDb : IdentityDbContext<ApplicationUser, ApplicationRole, Guid, IdentityUserClaim<Guid>, ApplicationUserRole, IdentityUserLogin<Guid>, IdentityRoleClaim<Guid>, IdentityUserToken<Guid>>
    {
        public AppDb(DbContextOptions<AppDb> options) : base(options) { }

        public DbSet<Game> Games => Set<Game>();
        public DbSet<Move> Moves => Set<Move>();
        public DbSet<GameParticipant> GameParticipants => Set<GameParticipant>();

        protected override void OnModelCreating(ModelBuilder b)
        {
            base.OnModelCreating(b);

            b.Entity<ApplicationUser>(e =>
            {
                e.Property(x => x.DisplayName).HasMaxLength(128);
            });

            b.Entity<ApplicationRole>(e =>
            {
                e.Property(x => x.Name).HasMaxLength(256);
                e.Property(x => x.NormalizedName).HasMaxLength(256);
            });

            b.Entity<ApplicationUserRole>(e =>
            {
                e.HasKey(x => new { x.UserId, x.RoleId });
                e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Cascade);
            });

            b.Entity<Game>(e =>
            {
                e.HasIndex(x => x.Code).IsUnique();
                e.Property(x => x.Code).HasMaxLength(16);
                e.Property(x => x.Fen).HasMaxLength(120);
                e.Property(x => x.Castling).HasMaxLength(4);
                e.Property(x => x.Turn).HasMaxLength(1);
                e.Property(x => x.Status).HasMaxLength(16);
            });

            b.Entity<Move>(e =>
            {
                e.HasIndex(x => new { x.GameId, x.Index }).IsUnique();
                e.Property(x => x.Flags).HasMaxLength(16);
                e.Property(x => x.Promotion).HasMaxLength(1);
                e.Property(x => x.FenAfter).HasMaxLength(120);
            });

            b.Entity<GameParticipant>(e =>
            {
                e.HasIndex(x => new { x.GameId, x.Color }).IsUnique();
                e.Property(x => x.Color).HasMaxLength(1);
                e.HasOne(x => x.Game).WithMany(g => g.Participants).HasForeignKey(x => x.GameId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.User).WithMany(u => u.Participations).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            });

            var adminRoleId = Guid.Parse("11111111-1111-1111-1111-111111111111");
            var playerRoleId = Guid.Parse("22222222-2222-2222-2222-222222222222");

            b.Entity<ApplicationRole>().HasData(
                new ApplicationRole { Id = adminRoleId, Name = "Admin", NormalizedName = "ADMIN" },
                new ApplicationRole { Id = playerRoleId, Name = "Player", NormalizedName = "PLAYER" }
            );
        }
    }
}
