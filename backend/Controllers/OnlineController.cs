using backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/online")]
    public sealed class OnlineController : ControllerBase
    {
        private readonly PresenceTracker _presence;
        public OnlineController(PresenceTracker presence) { _presence = presence; }

        [HttpGet("count")]
        public IActionResult Count() => Ok(new { count = _presence.Count });
    }
}
