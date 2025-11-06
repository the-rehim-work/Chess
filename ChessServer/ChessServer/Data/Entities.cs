using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ChessServer.Data
{
    public sealed class ApplicationUser : IdentityUser<Guid>
    {
        [MaxLength(128)]
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

        [MaxLength(16)]
        public string Code { get; set; } = string.Empty;

        [MaxLength(120)]
        public string Fen { get; set; } = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

        [MaxLength(4)]
        public string Castling { get; set; } = "KQkq";

        [MaxLength(1)]
        public string Turn { get; set; } = "w";

        public int Halfmove { get; set; }
        public int Fullmove { get; set; } = 1;

        public string? Outcome { get; set; }
        public string? Reason { get; set; }

        [MaxLength(16)]
        public string Status { get; set; } = "waiting";

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

        [MaxLength(16)]
        public string? Flags { get; set; }

        [MaxLength(1)]
        public string? Promotion { get; set; }

        [MaxLength(120)]
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

        [MaxLength(1)]
        public string Color { get; set; } = "w";

        public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    }

    public sealed class DirectThread
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Optional logical key identifier for client-side key rotation
        [MaxLength(64)]
        public string? ThreadKeyId { get; set; }

        public ICollection<DirectThreadMember> Members { get; set; } = new List<DirectThreadMember>();
        public ICollection<DirectMessage> Messages { get; set; } = new List<DirectMessage>();
    }

    public sealed class DirectThreadMember
    {
        public Guid Id { get; set; } = Guid.NewGuid();

        public Guid ThreadId { get; set; }
        public DirectThread Thread { get; set; } = null!;

        public Guid UserId { get; set; }
        public ApplicationUser User { get; set; } = null!;

        public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    }

    public sealed class DirectMessage
    {
        public Guid Id { get; set; } = Guid.NewGuid();

        public Guid ThreadId { get; set; }
        public DirectThread Thread { get; set; } = null!;

        public Guid SenderId { get; set; }
        public ApplicationUser Sender { get; set; } = null!;

        [MaxLength(64)] public string? KeyId { get; set; }
        [MaxLength(64)] public string? NonceB64 { get; set; }
        [MaxLength(64)] public string? MacB64 { get; set; }

        public string CiphertextB64 { get; set; } = string.Empty;

        [MaxLength(64)] public string BodyHashHex { get; set; } = string.Empty;

        public DateTime SentAt { get; set; } = DateTime.UtcNow;
        public DateTime? DeliveredAt { get; set; }
        public DateTime? ReadAt { get; set; }
    }

    public sealed class AppDb : IdentityDbContext<ApplicationUser, ApplicationRole, Guid,
        IdentityUserClaim<Guid>, ApplicationUserRole, IdentityUserLogin<Guid>,
        IdentityRoleClaim<Guid>, IdentityUserToken<Guid>>
    {
        public AppDb(DbContextOptions<AppDb> options) : base(options) { }

        public DbSet<Game> Games => Set<Game>();
        public DbSet<Move> Moves => Set<Move>();
        public DbSet<GameParticipant> GameParticipants => Set<GameParticipant>();

        public DbSet<DirectThread> DirectThreads => Set<DirectThread>();
        public DbSet<DirectThreadMember> DirectThreadMembers => Set<DirectThreadMember>();
        public DbSet<DirectMessage> DirectMessages => Set<DirectMessage>();

        protected override void OnModelCreating(ModelBuilder b)
        {
            base.OnModelCreating(b);

            b.Entity<ApplicationUser>(e =>
            {
                e.Property(x => x.DisplayName).HasMaxLength(128);
                e.Property(x => x.UserName).HasMaxLength(64).IsRequired();
                e.HasIndex(x => x.UserName).IsUnique();
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
                e.HasOne(x => x.Game).WithMany(g => g.Participants)
                    .HasForeignKey(x => x.GameId)
                    .OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.User).WithMany(u => u.Participations)
                    .HasForeignKey(x => x.UserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            b.Entity<DirectThread>(e =>
            {
                e.Property(x => x.ThreadKeyId).HasMaxLength(64);
                e.HasMany(t => t.Members).WithOne(m => m.Thread)
                    .HasForeignKey(m => m.ThreadId)
                    .OnDelete(DeleteBehavior.Cascade);
                e.HasMany(t => t.Messages).WithOne(m => m.Thread)
                    .HasForeignKey(m => m.ThreadId)
                    .OnDelete(DeleteBehavior.Cascade);
            });

            b.Entity<DirectThreadMember>(e =>
            {
                e.HasIndex(m => new { m.ThreadId, m.UserId }).IsUnique();
            });

            b.Entity<DirectMessage>(e =>
            {
                e.Property(m => m.KeyId).HasMaxLength(64);
                e.Property(m => m.NonceB64).HasMaxLength(64);
                e.Property(m => m.MacB64).HasMaxLength(64);
                e.Property(m => m.CiphertextB64).HasColumnType("nvarchar(max)");
                e.Property(m => m.BodyHashHex).HasMaxLength(64);
                e.HasIndex(m => m.BodyHashHex);
                e.HasIndex(m => m.ThreadId);
                e.HasIndex(m => m.SenderId);
            });

            var adminRoleId  = Guid.Parse("11111111-1111-1111-1111-111111111111");
            var playerRoleId = Guid.Parse("22222222-2222-2222-2222-222222222222");
            b.Entity<ApplicationRole>().HasData(
                new ApplicationRole { Id = adminRoleId,  Name = "Admin",  NormalizedName = "ADMIN"  },
                new ApplicationRole { Id = playerRoleId, Name = "Player", NormalizedName = "PLAYER" }
            );
        }
    }
}
